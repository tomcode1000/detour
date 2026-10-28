// Funding by bank transfer, made to behave as much like a card as transfers allow:
//  - meals and taxis go to the traveller as a daily allowance, one payment per day;
//  - the hotel is paid directly to the hotel, one payment per night, never via the traveller;
//  - only today's money is sent now; later days and nights are SCHEDULED, and cancelled
//    if the trip ends first, so money for days not stranded never leaves the company.
// It takes the same plan the rules make for a card and keeps the payments in line with it.
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
    items.push({ key: `meals-${d + 1}`, role: 'traveller', what: `Meals, day ${d + 1}`, amount: perDay, payAt: d === 0 ? start : localTime(start, d, '06:00', tz) });
  }
  items.push({ key: 'transport', role: 'traveller', what: 'Taxis & local transport', amount: breakdown.transport, payAt: start });
  if (nights > 0) {
    const perNight = round2(breakdown.lodging / nights);
    for (let k = 1; k <= nights; k++) {
      items.push({ key: `hotel-${k}`, role: 'hotel', what: `Hotel, night ${k}`, amount: perNight, payAt: Math.max(start, localTime(start, k - 1, '20:00', tz)) });
    }
  }
  return items.filter((i) => i.payAt <= activeTo).map((i) => ({ ...i, currency }));
}

export function createTransferFunding({ clock, backend, payees }) {
  const ledger = [];
  let allowance = null;
  let current = null; // the plan being paid, so the hotel payee matches the stranded city

  async function place(item) {
    const now = clock();
    const due = item.payAt <= now;
    const payee = payees(item.role, current);
    const attempt = ledger.filter((l) => l.key === item.key).length;
    const res = await backend.send({ ...item, attemptKey: `${item.key}#${attempt}`, payee, scheduleDays: due ? 0 : Math.max(1, Math.ceil((item.payAt - now) / 864e5)), reference: `Detour ${item.what}`.slice(0, 30) });
    const entry = { ...item, payeeName: payee.name, id: res.id, status: due ? 'SENT' : 'SCHEDULED', received: res.received, fee: res.fee, placedAt: now };
    ledger.push(entry);
    return entry;
  }

  async function cancel(entry) {
    await backend.cancel(entry.id);
    entry.status = 'CANCELLED';
    entry.cancelledAt = clock();
    return entry;
  }

  // Scheduled payments whose time has come are now sent (the bank executes them on the date).
  function tick() {
    for (const l of ledger) if (l.status === 'SCHEDULED' && l.payAt <= clock()) l.status = 'SENT';
  }

  async function reconcile(controls) {
    current = controls;
    tick();
    const want = paymentsFor(controls);
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
    // Approved one-off raises go to the traveller straight away, as top-ups.
    const extrasPaid = round2(ledger.filter((l) => l.key.startsWith('extra') && l.status !== 'CANCELLED').reduce((s, l) => s + l.amount, 0));
    const extraDue = round2((controls.breakdown.extras || 0) - extrasPaid);
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

    // Trip over: everything not yet paid is cancelled.
    async setStatus(id, status) {
      tick();
      const cancelled = [];
      if (status !== 'ACTIVE') {
        for (const l of ledger) if (l.status === 'SCHEDULED') cancelled.push(await cancel(l));
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
  };
}
