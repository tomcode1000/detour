// Funding by bank transfer, made to behave as much like a card as transfers allow:
//  - meals and taxis go to the traveller as a daily allowance, one payment per day;
//  - the hotel is paid directly to the hotel, one payment per night, never via the traveller;
//  - only today's money is sent now; later days and nights are SCHEDULED, and cancelled
//    if the trip ends first, so money for days not stranded never leaves the company.
// It takes the same plan the rules make for a card and keeps the payments in line with it.
// With a hotel card, the hotel nights are charged to a hotels-only virtual card instead of
// sent by transfer: the card's limit is always the nights still planned, and it closes with the trip.
import { localParts, localToUtc } from '../time.js';

const round2 = (n) => Math.round(n * 100) / 100;

function localTime(baseMs, dayOffset, hhmm, tz) {
  const [h, m] = hhmm.split(':').map(Number);
  const p = localParts(baseMs, tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset));
  return localToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, m, tz);
}

// The payments a plan calls for. Day 1's meals and the taxi money go at once; later days at
// 06:00 local; each hotel night at 20:00 local (check-in). Nothing due after the trip ends.
export function paymentsFor(controls) {
  const { tz, activeFrom: start, activeTo, nights, breakdown, currency } = controls;
  const items = [];
  const perDay = round2(breakdown.meals / (nights + 1));
  for (let d = 0; d <= nights; d++) {
    items.push({ key: `meals-${d + 1}`, role: 'traveller', what: `Day ${d + 1} meals`, amount: perDay, payAt: d === 0 ? start : localTime(start, d, '06:00', tz) });
  }
  items.push({ key: 'transport', role: 'traveller', what: 'Taxis and local transport', amount: breakdown.transport, payAt: start });
  if (nights > 0) {
    const perNight = round2(breakdown.lodging / nights);
    for (let k = 1; k <= nights; k++) {
      items.push({ key: `hotel-${k}`, role: 'hotel', what: `Night ${k} hotel`, amount: perNight, payAt: Math.max(start, localTime(start, k - 1, '20:00', tz)) });
    }
  }
  return items.filter((i) => i.payAt <= activeTo).map((i) => ({ ...i, currency }));
}

const HOTEL_MCCS = ['7011'];

// `roles` limits which payments this funding makes (['hotel'] when the card covers the rest).
export function createTransferFunding({ clock, backend, payees, hotelCard = null, traveller = null, roles = null }) {
  const ledger = [];
  let allowance = null;
  let current = null; // the plan being paid, so the hotel payee matches the stranded city
  let card = null;    // the hotels-only card, when there is one
  const onCard = (item) => hotelCard && item.role === 'hotel';

  // The card's limit covers every night charged or still planned, and nothing more.
  async function syncCard(controls, want) {
    const charged = ledger.filter((l) => l.method === 'card' && l.status === 'SENT');
    const planned = want.filter((w) => w.role === 'hotel' && !charged.some((l) => l.key === w.key));
    const limit = round2([...charged, ...planned].reduce((sum, l) => sum + l.amount, 0));
    if (!card && !planned.length) return;
    const c = { currency: controls.currency, mccs: HOTEL_MCCS, limit, activeFrom: controls.activeFrom, activeTo: controls.activeTo };
    if (!card) {
      const issued = await hotelCard.issue({ traveller, controls: c, requestId: `${allowance.id}-hotel` });
      card = { id: issued.id, last4: issued.last4, status: issued.status, limit, activeTo: c.activeTo };
    } else if (card.limit !== limit || card.activeTo !== c.activeTo) {
      await hotelCard.update(card.id, c);
      card.limit = limit;
      card.activeTo = c.activeTo;
    }
  }

  // The hotel charges the card at check-in. A charge right after the card is made can be
  // refused while the card's window settles, so that one reason gets a single retry.
  async function charge(entry) {
    const ask = () => hotelCard.authorize(card.id, { merchant: entry.payeeName, mcc: HOTEL_MCCS[0], amount: entry.amount, currency: entry.currency, label: entry.key });
    let tx = await ask();
    if (tx.reason === 'OUT_OF_ALLOWED_TIME_RANGE' && hotelCard.name === 'airwallex') { await new Promise((ok) => setTimeout(ok, 3000)); tx = await ask(); }
    entry.id = tx.id;
    entry.status = tx.status === 'APPROVED' ? 'SENT' : 'DECLINED';
    entry.reason = tx.reason || null;
    return entry;
  }

  async function place(item) {
    const now = clock();
    const due = item.payAt <= now;
    const payee = payees(item.role, current);
    if (onCard(item)) {
      const entry = { ...item, method: 'card', card: card.last4, payeeName: payee.name, id: null, status: 'SCHEDULED', received: null, fee: 0, placedAt: now };
      ledger.push(entry);
      return due ? charge(entry) : entry;
    }
    const attempt = ledger.filter((l) => l.key === item.key).length;
    const res = await backend.send({ ...item, attemptKey: `${item.key}#${attempt}`, payee, scheduleDays: due ? 0 : Math.max(1, Math.ceil((item.payAt - now) / 864e5)), reference: `Detour ${item.what}`.slice(0, 30) });
    const entry = { ...item, payeeName: payee.name, id: res.id, status: due ? 'SENT' : 'SCHEDULED', received: res.received, fee: res.fee, placedAt: now };
    ledger.push(entry);
    return entry;
  }

  async function cancel(entry) {
    if (entry.method !== 'card') await backend.cancel(entry.id); // a night not yet charged costs nothing to drop
    entry.status = 'CANCELLED';
    entry.cancelledAt = clock();
    return entry;
  }

  // Scheduled payments whose time has come are now sent (the bank executes them on the date),
  // and hotel nights whose check-in has come are charged to the card.
  async function tick() {
    for (const l of ledger) {
      if (l.status !== 'SCHEDULED' || l.payAt > clock()) continue;
      if (l.method === 'card') await charge(l);
      else l.status = 'SENT';
    }
  }

  async function reconcile(controls) {
    current = controls;
    await tick();
    const want = paymentsFor(controls).filter((i) => !roles || roles.includes(i.role));
    if (hotelCard) await syncCard(controls, want);
    const created = [];
    const cancelled = [];
    for (const w of want) {
      const have = ledger.find((l) => l.key === w.key && l.status !== 'CANCELLED');
      if (!have) created.push(await place(w));
      else if (have.status === 'SCHEDULED' && (have.amount !== w.amount || have.role !== w.role)) {
        cancelled.push(await cancel(have));
        created.push(await place(w));
      }
    }
    for (const l of ledger) {
      if (l.status === 'SCHEDULED' && !l.key.startsWith('extra') && !want.some((w) => w.key === l.key)) cancelled.push(await cancel(l));
    }
    if (card && cancelled.some((l) => l.method === 'card')) await syncCard(controls, want);
    // Approved one-off raises go to the traveller straight away, as top-ups.
    const extrasPaid = round2(ledger.filter((l) => l.key.startsWith('extra') && l.status !== 'CANCELLED').reduce((s, l) => s + l.amount, 0));
    const extraDue = roles && !roles.includes('traveller') ? 0 : round2((controls.breakdown.extras || 0) - extrasPaid);
    if (extraDue > 0) {
      const n = ledger.filter((l) => l.key.startsWith('extra')).length + 1;
      created.push(await place({ key: `extra-${n}`, role: 'traveller', what: 'Approved extra', amount: extraDue, currency: controls.currency, payAt: clock() }));
    }
    return { created, cancelled };
  }

  return {
    kind: 'transfer',
    name: backend.name,
    label: backend.label,

    async issue({ controls, requestId }) {
      allowance = { id: `allowance-${requestId}`, status: 'ACTIVE', controls: { ...controls }, last4: null };
      const changes = await reconcile(controls);
      return { ...allowance, changes };
    },

    async update(id, controls) {
      allowance.controls = { ...controls };
      const changes = await reconcile(controls);
      return { ...allowance, changes };
    },

    // Trip over: everything not yet paid is cancelled, and the hotel card is closed.
    async setStatus(id, status) {
      await tick();
      const cancelled = [];
      if (status !== 'ACTIVE') {
        for (const l of ledger) if (l.status === 'SCHEDULED') cancelled.push(await cancel(l));
        if (card && card.status !== 'CLOSED') card.status = (await hotelCard.setStatus(card.id, 'CLOSED')).status;
      }
      allowance.status = status;
      return { ...allowance, changes: { created: [], cancelled } };
    },

    async authorize(cardId, ev) {
      return { id: null, cardId, at: clock(), ...ev, status: 'DECLINED', reason: 'NOT_A_CARD' };
    },
    async transactions() { return []; },
    tick,
    ledger: () => ledger.map((l) => ({ ...l })),
    hotelCard: () => card && { ...card },
  };
}
