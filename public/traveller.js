// Detour traveller app: sign in with the invited email, finish registering, then the trip,
// messages and what is covered. Shared helpers come from app-core.js.
let S = null;        // live state from the server
let INV = null;      // this traveller's invite (trip, company, registration)
let seenDetour = 0;  // Detour messages already seen, for the unread count
let lastChatCount = -1;
const KEY = 'detour.traveller';
try { localStorage.setItem('detour.role', 'traveller'); } catch {}

const session = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} },
  clear() { try { localStorage.removeItem(KEY); } catch {} },
};
const live = () => Boolean(INV?.live);
const firstName = () => (INV?.registration?.name || INV?.name || '').split(' ')[0];

// ---------------------------------------------------------------- start
async function start() {
  if (EMBED) return enter(await find({ token: 'ada-demo' }), { skipOnboarding: true });
  const token = params.get('invite');
  if (token) {
    history.replaceState(null, '', '/traveller');
    const inv = await find({ token });
    if (inv) return enter(inv);
    return go('signin', { replace: true });
  }
  const saved = session.get();
  if (saved?.token) {
    const inv = await find({ token: saved.token }, true);
    if (inv) return enter(inv);
    session.clear();
  }
  go('signin', { replace: true });
}

async function find(q, quiet = false) {
  const j = await api('/api/traveller/find', q, { quiet: true });
  if (!j.ok) { if (!quiet && q.email) $('signin-error').textContent = j.error; return null; }
  return j.result;
}

function enter(inv, { skipOnboarding = false } = {}) {
  if (!inv) return go('signin', { replace: true });
  INV = inv;
  if (inv.expired) {
    $('x-lede').textContent = `Ask ${inv.manager || 'your travel manager'} to send a new one.`;
    return go('expired', { replace: true });
  }
  if (inv.registration || skipOnboarding) {
    session.set({ token: inv.token, email: inv.email });
    showMain();
    return;
  }
  renderWelcome();
  go('welcome', { replace: true });
}

function showMain() {
  $('top-actions').hidden = false;
  go('home', { replace: true });
  if (S) render(S);
}

// ---------------------------------------------------------------- sign in
$('signin-form').onsubmit = async (e) => {
  e.preventDefault();
  const email = $('signin-email').value.trim();
  $('signin-error').textContent = '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('signin-error').textContent = 'Enter the email address your invite was sent to.'; return; }
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  const inv = await find({ email });
  btn.disabled = false;
  if (inv) enter(inv);
};
$('x-again').onclick = () => { session.clear(); go('signin', { replace: true }); };

// ---------------------------------------------------------------- trip model (live trip or invited trip)
function legs() {
  if (live() && S) return S.legs.map((f) => ({ ...f, dep: f.est_dep, arr: f.est_arr }));
  return (INV?.flights || []).map((f) => ({ id: f.id, from: f.from, to: f.to, dep: Date.parse(f.dep), arr: f.arr ? Date.parse(f.arr) : null, status: 'SCHEDULED', statusText: 'on time' }));
}
const tzOf = (code) => AIRPORTS[code]?.[3] || 'UTC';
const routeCodes = (ls) => (ls.length ? [ls[0].from, ...ls.map((l) => l.to)] : []);
function nextLeg(ls) { return ls.find((l) => l.status !== 'LANDED' && l.status !== 'DEPARTED') || ls.at(-1); }
function legState(l) {
  if (l.status === 'LANDED' || l.status === 'DEPARTED') return 'done';
  const d = live() && S?.disruption;
  if (l.status === 'CANCELLED' || (d && d.missedFlight === l.id)) return 'broken';
  if (d && !INV.flights.some((f) => f.id === l.id)) return 'new';
  return 'next';
}
function flightPill(f) {
  if (f.status === 'CANCELLED') return '<span class="pill bad">Cancelled</span>';
  if (f.status === 'LANDED') return '<span class="pill plain">Landed</span>';
  if (f.status === 'DEPARTED') return '<span class="pill info">In the air</span>';
  if (live() && S?.disruption?.missedFlight === f.id && !S.disruption.closed) return '<span class="pill bad">Missed</span>';
  if (/late/.test(f.statusText || '')) return `<span class="pill warn">${esc(f.statusText.replace('running ', '').replace(/^./, (c) => c.toUpperCase()))}</span>`;
  return '<span class="pill ok"><i class="live"></i>On time</span>';
}

function avatarHtml(size = '') {
  return live() ? `<span class="avatar photo ${size}"><img src="/img/app/ada.jpg" alt=""></span>` : `<span class="avatar ${size}">${esc(initials(INV?.name || '?'))}</span>`;
}
function whoHtml() {
  return `${avatarHtml('lg')}<div><b>${esc(INV.registration?.name || INV.name)}<span class="tag">Traveller</span></b><small>${esc(INV.company || companyName(S || {}))}</small></div>`;
}

function flightCard(ls) {
  if (!ls.length) return '';
  const f = nextLeg(ls);
  const codes = routeCodes(ls);
  const link = (i) => {
    const st = legState(ls[i]);
    return `<span class="link ${st === 'broken' ? 'broken' : ''}">${icon('plane')}</span>`;
  };
  const aps = codes.map((c, i) => `<div class="ap ${i === 0 ? '' : i === codes.length - 1 ? 'r' : 'c'}"><b>${esc(c)}</b><small>${esc(city(c))}</small></div>`);
  const route = aps.flatMap((ap, i) => (i < aps.length - 1 ? [ap, link(i)] : [ap])).join('');
  const tz = tzOf(f.from);
  return `<div class="card pad">
    <div class="flight-head">${icon('plane')}<b>${esc(f.id)}</b>${flightPill(f)}</div>
    <div class="route">${route}</div>
    <div class="meta"><span>${icon('calendar')}${esc(dayDate(f.dep, tz))}</span><span>${icon('clock')}${esc(hm(f.dep, tz))} ${esc(city(f.from))} time</span></div>
  </div>`;
}

// ---------------------------------------------------------------- render
function render(s) {
  const before = S;
  S = s;
  if (!INV) return;
  if (INV.live && s.account) {
    const mine = s.account.invites.find((i) => i.token === INV.token);
    if (!mine && !EMBED) { session.clear(); INV = null; $('top-actions').hidden = true; go('signin', { replace: true }); return; }
  }
  $('top-avatar').innerHTML = live() ? '<img src="/img/app/ada.jpg" alt="">' : esc(initials(INV.name));
  $('top-avatar').classList.toggle('photo', live());
  renderHome();
  renderTrips();
  renderChat();
  renderMore();
  renderSheetInbox();
  if (before && live() && !$('top-actions').hidden) momentsFor(before, s);
}

// ---------------------------------------------------------------- moments: what Ada sees the instant something happens
function momentsFor(a, b) {
  const tz = b.tz;
  const was = (id) => (a.payments || []).find((l) => l.id === id);
  const pays = b.payments || [];
  const d = b.disruption;
  const rates = d ? b.policy.cities[d.airport] : null;
  const whole = (n, c) => money(n, c, { maximumFractionDigits: 0 });

  // A disruption is detected
  if (d && !d.closed && (!a.disruption || a.disruption.seq !== d.seq)) {
    const title = /cancelled/.test(d.reason) ? 'Your flight is cancelled' : /arrives too late/.test(d.reason) ? 'You will miss your connection' : 'Your flight is delayed';
    moment({
      tone: 'warn', icon: 'warn', title,
      sub: `Detour is on it. You're covered in ${city(d.airport)}, inside ${companyName(b)}'s policy.`,
      rows: rates ? [
        ['meal', 'Meals, sent to your account', `${whole(rates.meals_per_day, rates.currency)} / day`],
        ['car', 'Taxis and transport', whole(rates.transport, rates.currency)],
        ['bed', 'Hotel, paid directly if you stay', `${whole(rates.lodging_per_night * b.policy.rules.lodging_factor, rates.currency)} / night`],
      ] : [],
      primary: { label: "See what's covered", go: 'home' },
    });
  }

  // Money reaches the traveller's account
  const sentToMe = pays.filter((l) => l.role === 'traveller' && l.status === 'SENT' && was(l.id)?.status !== 'SENT');
  if (sentToMe.length) {
    const rec = sentToMe.filter((l) => l.received);
    const home = rec[0]?.received.currency;
    const last4 = INV.registration?.bank.last4;
    moment({
      tone: 'ok', icon: 'check', title: 'Money received',
      amount: home ? money(sum(rec, (l) => l.received.amount), home) : money(sum(sentToMe), sentToMe[0].currency),
      amountNote: last4 ? `In your account ending ${last4}` : 'In your bank account',
      rows: sentToMe.map((l) => [/meals/.test(l.what) ? 'meal' : /Taxi/.test(l.what) ? 'car' : 'wallet', l.what, money(l.amount, l.currency)]),
      ref: `Paid through Airwallex · ${dateHm(b.clock, tz)}`,
      primary: { label: 'Done' },
    });
  }

  // The hotel is paid directly
  const hotel = pays.filter((l) => l.role === 'hotel' && l.status === 'SENT' && was(l.id)?.status !== 'SENT');
  if (hotel.length) {
    moment({
      tone: 'ok', icon: 'bed', title: 'Your hotel is paid',
      sub: `${hotel[0].payeeName.replace(/\s+GmbH$/, '')} has been paid by ${companyName(b)}. Just give your name at the desk.`,
      amount: money(sum(hotel), hotel[0].currency), amountNote: hotel.map((l) => l.what).join(' · '),
      primary: { label: 'Done' },
    });
  }

  // Payments no longer needed are cancelled before they are paid
  const cancelled = pays.filter((l) => l.status === 'CANCELLED' && was(l.id) && was(l.id).status !== 'CANCELLED');
  if (cancelled.length) {
    moment({
      tone: 'info', icon: 'refresh', title: 'Not needed, cancelled',
      sub: 'Your plans changed, so these were cancelled before they were paid. Nothing to give back.',
      rows: cancelled.map((l) => [l.role === 'hotel' ? 'bed' : 'wallet', l.what, money(l.amount, l.currency)]),
      primary: { label: 'Done' },
    });
  }

  // A request goes to the travel manager, and the decision comes back
  for (const ap of b.approvals) {
    const old = a.approvals.find((x) => x.id === ap.id);
    const what = ap.kind === 'nights' ? `Night ${ap.to.nights} in ${ap.to.city}` : `Extra cover in ${ap.to.city}`;
    if (!old && ap.status === 'PENDING') {
      moment({ tone: 'info', icon: 'clock', title: `Asked ${b.manager.split(' ')[0]} for you`, sub: `${what} needs your travel manager's approval. We'll tell you the moment they decide.`, progress: true, primary: { label: 'OK' } });
    } else if (old?.status === 'PENDING' && ap.status === 'APPROVED') {
      moment({ tone: 'ok', icon: 'check', title: `${what} approved`, sub: `${b.manager} approved it.${ap.kind === 'nights' ? ' Your hotel is paid directly for another night.' : ''}`, amount: `+${money(ap.delta, ap.to.currency)}`, amountNote: `Covered until ${dayHm(ap.to.activeTo, tz)}`, primary: { label: 'Done' } });
    } else if (old?.status === 'PENDING' && ap.status === 'DECLINED') {
      moment({ tone: 'bad', icon: 'x', title: `${what} declined`, sub: `${b.manager} declined this one. Message Detour if your plans change.`, primary: { label: 'Message Detour', go: 'messages' }, secondary: { label: 'Close' } });
    }
  }

  // A fake airline message is caught
  for (const m of b.inbox || []) {
    const old = (a.inbox || []).find((x) => x.id === m.id);
    if (m.verdict === 'suspicious' && old?.verdict !== 'suspicious') {
      moment({ tone: 'bad', icon: 'shield-o', title: 'This looks like a scam', sub: `"${m.subject}" asks for money or details and does not match your flight status. Nothing was changed. Don't reply to it.`, primary: { label: 'OK' } });
    } else if (m.verdict === 'confirmed' && old?.verdict !== 'confirmed') {
      toast('Airline message read. It matches your flight status.');
    }
  }

  // The trip is resolved
  if (b.summary && !a.summary) {
    const sm = b.summary;
    moment({
      tone: 'ok', icon: 'check', title: 'Trip resolved', sub: 'Have a good flight. Nothing to claim and no receipts to keep.',
      rows: sm.mode === 'transfer'
        ? [['wallet', 'Sent to you', money(sm.toTraveller, sm.currency)], ['bed', 'Hotel, paid directly', money(sm.toHotel, sm.currency)], ['refresh', 'Cancelled, never paid', money(sm.cancelled, sm.currency)]]
        : [['card', 'Spent on your card', money(sm.spent, sm.currency)]],
      primary: { label: 'Back to home', go: 'home' },
    });
  }
}

// Disruption progress on Home: detected, support, payment, resolved
function stepperHtml() {
  const d = live() ? S?.disruption : null;
  if (!d && !S?.summary) return '';
  const paid = toTraveller().some((l) => l.status === 'SENT');
  const done = [Boolean(d), Boolean(S.card), paid, Boolean(S.summary || d?.closed)];
  const now = done.indexOf(false);
  const steps = [['plane', 'Disruption detected'], ['shield-o', 'Support provided'], ['card', 'Payment sent'], ['home', 'Trip resolved']];
  return `<ol class="card stepper">${steps.map(([ic, label], i) => `<li class="${done[i] ? 'done' : i === now ? 'now' : ''}"><span class="dot">${icon(done[i] ? 'check' : ic)}</span><b>${label}</b></li>`).join('')}</ol>`;
}

const toTraveller = () => (S?.payments || []).filter((l) => l.role === 'traveller');
const hotelPays = () => (S?.payments || []).filter((l) => l.role === 'hotel');

function statusBanner() {
  if (!live() || !S) return `<div class="banner ok"><span class="badge">${icon('check')}</span><div class="grow"><b>Your trip is on track</b><small>Detour watches your flights and steps in if one is disrupted.</small></div></div>`;
  const d = S.disruption;
  if (S.summary) {
    const sm = S.summary;
    const sent = sm.mode === 'transfer' ? `Detour sent you ${money(sm.toTraveller, sm.currency)} and paid your hotel.` : `You spent ${money(sm.spent, sm.currency)} on your Detour card.`;
    return `<div class="banner ok"><span class="badge">${icon('check')}</span><div class="grow"><b>Trip resolved</b><small>${esc(sent)} Nothing to claim, no receipts.</small></div></div>`;
  }
  if (d && !d.closed) {
    const title = /cancelled/.test(d.reason) ? 'Flight cancelled' : /arrives too late/.test(d.reason) ? 'Connection missed' : 'Flight delayed';
    return `<button class="banner bad" data-go="trips"><span class="badge">${icon('warn')}</span><div class="grow"><b>${title}</b><small>Detour is on it. You're covered in ${esc(city(d.airport))}.</small></div><time>${esc(ago(d.start, S.clock))}</time></button>`;
  }
  if (d && d.closed) return `<div class="banner info"><span class="badge">${icon('plane')}</span><div class="grow"><b>Have a good flight</b><small>Your cover has ended. Anything you didn't need was cancelled before it was paid.</small></div></div>`;
  return `<div class="banner ok"><span class="badge">${icon('check')}</span><div class="grow"><b>Your trip is on track</b><small>Detour watches your flights and steps in if one is disrupted.</small></div></div>`;
}

function renderHome() {
  const ls = legs();
  $('h-who').innerHTML = whoHtml();
  const steps = stepperHtml();
  $('h-status').innerHTML = statusBanner() + (steps ? `<div style="margin-top:12px">${steps}</div>` : '');
  $('h-flight').innerHTML = flightCard(ls);

  const rows = [];
  const c = live() ? S?.card : null;
  const d = live() ? S?.disruption : null;
  if (c && c.status === 'ACTIVE') {
    rows.push(`<button class="row tap" data-go="trips"><span class="ic green">${icon('shield')}</span><div class="grow"><b>Coverage active</b><small>In ${esc(c.controls.city)} until ${esc(dayHm(c.controls.activeTo, S.tz))}</small></div>${icon('chev-r', 'chev')}</button>`);
  } else if (!S?.summary) {
    rows.push(`<div class="row"><span class="ic green">${icon('shield')}</span><div class="grow"><b>Coverage ready</b><small>Starts the moment a flight on your trip is disrupted</small></div></div>`);
  }
  if (live() && S?.mode === 'transfer') {
    const mine = toTraveller();
    const sent = mine.filter((l) => l.status === 'SENT');
    const rec = sent.filter((l) => l.received);
    const sched = mine.filter((l) => l.status === 'SCHEDULED');
    if (mine.length) {
      const cur = rec[0]?.received.currency || INV.registration?.homeCurrency || 'SGD';
      const more = sched.length ? ` · ${money(sum(sched), sched[0].currency)} more scheduled` : '';
      rows.push(`<button class="row tap" data-go="trips"><span class="ic">${icon('wallet')}</span><div class="grow"><b>${money(sum(rec, (l) => l.received.amount), cur)}</b><small>Received in your account${esc(more)}</small></div>${icon('chev-r', 'chev')}</button>`);
    }
  } else if (c) {
    rows.push(`<div class="row"><span class="ic">${icon('card')}</span><div class="grow"><b>${money(c.remaining, c.controls.currency)}</b><small>Left on your Detour card</small></div></div>`);
  }
  const hotel = hotelPays().filter((l) => l.status !== 'CANCELLED');
  if (live() && hotel.length && !S.summary) {
    const name = hotel[0].payeeName.replace(/\s+GmbH$/, '');
    rows.push(`<button class="row tap" data-go="trips"><img class="thumb" src="/img/app/hotel.jpg" alt=""><div class="grow"><b>Hotel accommodation</b><small>${esc(name)} · ${hotel.length} night${hotel.length > 1 ? 's' : ''} paid</small></div>${icon('chev-r', 'chev')}</button>`);
  }
  $('h-rows').innerHTML = rows.map((r) => `<div class="card">${r}</div>`).join('');

  // What's covered, while the disruption is open
  if (c && c.status === 'ACTIVE' && d && !d.closed && S.mode === 'transfer') {
    const rates = S.policy.cities[d.airport];
    const cur = c.controls.currency;
    const pays = S.payments || [];
    const mealRows = pays.filter((l) => /meals/.test(l.what));
    const meals = mealRows.filter((l) => l.status === 'SENT').length;
    const nights = hotelPays().filter((l) => l.status !== 'CANCELLED').length;
    const perNight = Math.round(rates.lodging_per_night * S.policy.rules.lodging_factor * 100) / 100;
    $('h-covered').innerHTML = `<div class="section-head"><h2>What's covered in ${esc(city(d.airport))}</h2></div>
      <div class="card">
        <div class="row"><span class="ic">${icon('meal')}</span><div class="grow"><b>Meals</b><small>${meals ? `${meals} day${meals > 1 ? 's' : ''} sent to your account` : 'Sent to your account each morning'}</small></div><div class="end"><b>${money(rates.meals_per_day, cur)}</b><small>per day</small></div></div>
        <div class="row"><span class="ic">${icon('car')}</span><div class="grow"><b>Taxis and transport</b><small>Sent to your account</small></div><div class="end"><b>${money(rates.transport, cur)}</b><small>per stay</small></div></div>
        <div class="row"><span class="ic">${icon('bed')}</span><div class="grow"><b>Hotel</b><small>${nights ? `Paid directly · ${nights} night${nights > 1 ? 's' : ''}` : 'Added if you need to stay the night'}</small></div><div class="end"><b>${money(perNight, cur)}</b><small>per night</small></div></div>
      </div>`;
  } else {
    $('h-covered').innerHTML = '';
  }
  $('h-share').hidden = !live();
  $('h-fine').textContent = live() ? 'Demo trip: scripted flight feed and fictional people. Payments run in the Airwallex sandbox.' : '';
}

function renderTrips() {
  const ls = legs();
  if (!ls.length) return;
  const codes = routeCodes(ls);
  $('t-sub').textContent = `${codes.join(' → ')} · ${dayDate(ls[0].dep, tzOf(ls[0].from))}`;
  if (currentView === 'trips') drawTripMap();
  $('t-legs').innerHTML = ls.map((f) => `<div class="row"><span class="ic plain">${icon('plane')}</span><div class="grow"><b>${esc(f.id)} · ${esc(f.from)} → ${esc(f.to)}</b><small>Departs ${esc(dateHm(f.dep, tzOf(f.from)))} ${esc(city(f.from))} time</small></div>${flightPill(f)}</div>`).join('');

  const c = live() ? S?.card : null;
  if (c && S.mode === 'transfer') {
    const pays = S.payments || [];
    $('t-cover').innerHTML = `<div class="section-head"><h2>Payments for this stay</h2></div><div class="card">${pays.slice().reverse().map((l) => {
      const when = l.status === 'SENT' ? `Sent ${dayHm(l.payAt, S.tz)}` : l.status === 'SCHEDULED' ? `Due ${dayHm(l.payAt, S.tz)}` : 'Not needed';
      const pill = { SENT: '<span class="pill ok">Paid</span>', SCHEDULED: '<span class="pill warn">Scheduled</span>', CANCELLED: '<span class="pill plain">Cancelled</span>' }[l.status] || '';
      const amt = l.role === 'traveller' && l.received && l.received.currency !== l.currency ? money(l.received.amount, l.received.currency) : money(l.amount, l.currency);
      return `<div class="row ${l.status === 'CANCELLED' ? 'off' : ''}"><span class="ic ${l.role === 'hotel' ? 'purple' : ''}">${icon(l.role === 'hotel' ? 'bed' : /meals/.test(l.what) ? 'meal' : /Taxi/.test(l.what) ? 'car' : 'wallet')}</span><div class="grow"><b>${esc(l.what)}</b><small>${l.role === 'hotel' ? 'Paid to the hotel' : 'To your account'} · ${esc(when)}</small></div><div class="end"><b>${esc(amt)}</b>${pill}</div></div>`;
    }).join('') || '<div class="empty">No payments yet.</div>'}</div>`;
  } else {
    $('t-cover').innerHTML = '';
  }

  const inbox = live() ? (S?.inbox || []).slice().reverse() : [];
  const lock = S?.busy || S?.playing;
  $('t-inbox').innerHTML = inbox.length ? inbox.map((m) => `<div class="row"><span class="ic plain">${icon('mail')}</span><div class="grow"><b>${esc(m.subject)}</b><small>${esc(m.from.replace(/\s*<.*>/, ''))} · ${esc(dayHm(m.at, S.tz))}</small></div>${verdictPill(m) || `<button class="btn ghost" style="height:34px;padding:0 14px;font-size:13.5px" data-forward="${esc(m.id)}" ${lock ? 'disabled' : ''}>Share</button>`}</div>`).join('')
    : '<div class="empty">Airline emails show here. Only the ones you share are read by Detour.</div>';
}
function verdictPill(m) {
  if (!m.shared) return '';
  return { suspicious: '<span class="pill bad">Suspicious</span>', confirmed: '<span class="pill ok">Confirmed</span>', unconfirmed: '<span class="pill plain">Not confirmed</span>' }[m.verdict] || '<span class="pill plain">Reading…</span>';
}
function drawTripMap() {
  const ls = legs();
  const d = live() ? S?.disruption : null;
  drawRoute($('trip-map'), ls.map((l) => ({ from: l.from, to: l.to, state: legState(l) })), { stay: d && !d.closed ? d.airport : null });
}
onView('trips', () => { if (INV) drawTripMap(); });

// ---------------------------------------------------------------- messages
function renderChat() {
  const chat = $('chat');
  if (!live()) {
    chat.innerHTML = `<div class="empty">Detour will message you here if a flight on your trip is disrupted. You can reply any time.</div>`;
    $('chat-text').disabled = true;
    $('chat-text').placeholder = 'Messages open when your trip starts';
    return;
  }
  const tz = S.tz;
  const writing = S.activity && /^(Messaging|Replying|Reading .*message)/.test(S.activity);
  $('chat-status').innerHTML = writing ? '<span class="c-cyan">Typing…</span>' : 'Your trip assistant';
  if (!S.messages.length && !writing) {
    chat.innerHTML = `<div class="empty">Messages from Detour appear here. Ask anything, for example if the hotel asks you for a deposit.</div>`;
  } else {
    let lastDay = '';
    chat.innerHTML = S.messages.map((m) => {
      const day = fmt(m.at, tz, { weekday: 'long', day: 'numeric', month: 'long' });
      const sep = day !== lastDay ? `<div class="day">${esc(day)}</div>` : '';
      lastDay = day;
      if (m.kind === 'share') {
        const how = { screenshot: 'Screenshot', forwarded: 'Forwarded email', shared: 'Shared message' }[m.how] || 'Airline message';
        return `${sep}<div class="msg me"><div class="attach"><span class="doc">${icon('doc')}</span><div class="grow"><b>Airline message</b><small>${esc(how)} · ${esc(m.text)}</small></div><small>${hm(m.at, tz)}</small></div></div>`;
      }
      if (m.from === 'traveller') return `${sep}<div class="msg me"><div class="bubble">${esc(m.text)}<time>${hm(m.at, tz)}</time></div></div>`;
      return `${sep}<div class="msg them"><svg class="bot"><use href="#logo"/></svg><div class="bubble">${esc(m.text)}<time>${hm(m.at, tz)}</time></div></div>`;
    }).join('') + (writing ? '<div class="typing" aria-label="Detour is writing"><span></span><span></span><span></span></div>' : '');
  }
  const count = S.messages.length + (writing ? 1 : 0);
  if (count !== lastChatCount) chat.scrollTop = chat.scrollHeight;
  lastChatCount = count;

  const fromDetour = S.messages.filter((m) => m.from === 'detour').length;
  if (currentView === 'messages') seenDetour = fromDetour;
  const unread = Math.max(0, fromDetour - seenDetour);
  $('msg-count').hidden = !unread;
  $('msg-count').textContent = unread;
  $('bell-dot').hidden = !unread;

  const lock = S.busy || S.playing;
  $('chat-text').disabled = lock;
  $('composer').querySelector('.send').disabled = lock;
  $('chat-clip').disabled = lock;
  $('chat-text').placeholder = lock ? 'Detour is working…' : 'Type a message…';
}
onView('messages', () => { if (S && INV) { seenDetour = S.messages.filter((m) => m.from === 'detour').length; renderChat(); $('chat').scrollTop = $('chat').scrollHeight; } });
$('composer').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('chat-text').value.trim();
  if (!text || !live() || S?.busy || S?.playing) return;
  $('chat-text').value = '';
  await api('/api/chat', { text });
};

// ---------------------------------------------------------------- more
function renderMore() {
  $('m-who').innerHTML = whoHtml();
  const r = INV.registration;
  if (!r) {
    $('m-details').innerHTML = `<div class="row"><span class="ic plain">${icon('mail')}</span><div class="grow"><small style="margin:0 0 2px">Email</small><b>${esc(INV.email)}</b></div></div>
      <button class="row tap" data-go="reg1"><span class="ic orange">${icon('bank')}</span><div class="grow"><b>Finish registration</b><small>Add your phone and the bank account for allowances</small></div>${icon('chev-r', 'chev')}</button>
      <div class="row"><span class="ic plain">${icon('briefcase')}</span><div class="grow"><small style="margin:0 0 2px">Travel manager</small><b>${esc(INV.manager || '')} · ${esc(INV.company || '')}</b></div></div>`;
    return;
  }
  const rows = [
    ['mail', 'Email', INV.email],
    ['phone', 'Mobile', r?.phone || 'Not added'],
    ['currency', 'Home currency', r?.homeCurrency || '—'],
    ['bank', 'Bank account', r ? `•••• ${r.bank.last4} · ${r.bank.code}` : 'Not added'],
    ['briefcase', 'Travel manager', `${INV.manager || ''} · ${INV.company || ''}`],
  ];
  $('m-details').innerHTML = rows.map(([ic, k, v]) => `<div class="row"><span class="ic plain">${icon(ic)}</span><div class="grow"><small style="margin:0 0 2px">${esc(k)}</small><b>${esc(v)}</b></div></div>`).join('');
}
$('m-signout').onclick = () => { session.clear(); INV = null; $('top-actions').hidden = true; go('signin', { replace: true }); };

// ---------------------------------------------------------------- welcome and registration
function renderWelcome() {
  const ls = legs();
  const codes = routeCodes(ls);
  $('w-title').innerHTML = `Hi ${esc(firstName())},<br><em>you're covered.</em>`;
  $('w-lede').textContent = `${INV.company} has set up Detour for your trip.`;
  const tz = ls[0] ? tzOf(ls[0].from) : 'UTC';
  $('w-trip').innerHTML = `<div class="flight-head">${icon('plane')}<b>${esc(codes.map(city).join(' → '))}</b></div>
    <div class="meta" style="border:0;padding-top:4px;margin-top:6px;flex-wrap:wrap;gap:10px 18px"><span>${icon('calendar')}${ls[0] ? esc(dayDate(ls[0].dep, tz)) : ''}</span><span>${icon('plane')}${esc(ls.map((l) => l.id).join(' · '))}</span></div>`;
  $('w-by').innerHTML = `<span class="avatar">${esc(initials(INV.manager || 'S'))}</span><div class="grow"><small style="margin:0">Invited by</small><b>${esc(INV.manager)}, Travel manager</b></div>`;
  $('r-name').value = INV.name;
  $('r-holder').value = INV.name;
}

$('reg1-form').onsubmit = (e) => {
  e.preventDefault();
  const err = $('reg1-error');
  err.textContent = '';
  if (!$('r-name').value.trim()) { err.textContent = 'Add your full name.'; return; }
  if (!/^\+?[\d\s()-]{7,}$/.test($('r-phone').value.trim())) { err.textContent = 'Add a mobile number, with the country code.'; return; }
  if (!$('r-holder').value.trim() || $('r-holder').value === INV.name) $('r-holder').value = $('r-name').value.trim();
  go('reg2');
};
$('reg2-form').onsubmit = async (e) => {
  e.preventDefault();
  $('reg2-error').textContent = '';
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>Saving';
  const j = await api('/api/traveller/register', {
    token: INV.token,
    name: $('r-name').value,
    phone: $('r-phone').value,
    homeCurrency: $('r-cur').value,
    bank: { country: $('r-country').value, holder: $('r-holder').value, account: $('r-account').value, code: $('r-code').value },
    messages: $('r-msgs').checked,
  }, { quiet: true });
  btn.disabled = false;
  btn.textContent = 'Finish';
  if (!j.ok) { $('reg2-error').textContent = j.error; return; }
  INV.registration = j.result;
  session.set({ token: INV.token, email: INV.email });
  $('r-account').value = '';
  go('mapintro', { replace: true });
};

onView('mapintro', () => {
  const ls = legs();
  drawRoute($('intro-map'), ls.map((l) => ({ from: l.from, to: l.to, state: 'next' })));
  const f = nextLeg(ls);
  $('intro-next').innerHTML = f ? `<div class="row"><span class="ic">${icon('plane')}</span><div class="grow"><small style="margin:0 0 2px">Next flight</small><b>${esc(f.id)} · ${esc(f.from)} → ${esc(f.to)}</b><small>${esc(dateHm(f.dep, tzOf(f.from)))} ${esc(city(f.from))} time</small></div>${flightPill(f)}</div>` : '';
});
$('intro-go').onclick = showMain;

// ---------------------------------------------------------------- share an airline message
let sheetHow = 'pasted';
function openSheet(text = '', how = 'pasted') {
  if (!live()) { toast('Sharing opens when your trip starts.'); return; }
  sheetHow = how;
  $('sheet-text').value = text;
  $('sheet-status').textContent = 'JPG or PNG · read on your phone';
  $('sheet').hidden = false;
  $('scrim').hidden = false;
}
function closeSheet() { $('sheet').hidden = true; $('scrim').hidden = true; }
function renderSheetInbox() {
  const items = live() ? (S?.inbox || []).filter((m) => !m.shared).slice().reverse() : [];
  $('sheet-inbox').innerHTML = items.length ? `<div class="or">or forward from your inbox</div><div class="card">${items.map((m) => `<button class="row tap" data-forward="${esc(m.id)}"><span class="ic plain">${icon('mail')}</span><div class="grow"><b>${esc(m.subject)}</b><small>${esc(m.from.replace(/\s*<.*>/, ''))}</small></div>${icon('send', 'chev')}</button>`).join('')}</div>` : '';
}
$('h-share').onclick = () => openSheet();
$('chat-clip').onclick = () => openSheet();
$('sheet-x').onclick = closeSheet;
$('sheet-cancel').onclick = closeSheet;
$('scrim').onclick = closeSheet;
$('sheet-send').onclick = async () => {
  const text = $('sheet-text').value.trim();
  if (!text) { $('sheet-status').textContent = 'Paste a message or add a screenshot first.'; return; }
  if (S?.busy || S?.playing) { toast('Detour is busy. Try again in a moment.'); return; }
  closeSheet();
  go('messages', { replace: true });
  await api('/api/airline-message', { text, how: sheetHow });
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-forward]');
  if (!b || b.disabled) return;
  b.disabled = true;
  closeSheet();
  api('/api/airline-message', { inboxId: b.dataset.forward, how: 'forwarded' });
  go('messages', { replace: true });
});

// Screenshots are read on the phone (Tesseract, loaded only when needed); only the text is sent.
let ocrLib = null;
async function readImage(file) {
  $('sheet-status').innerHTML = '<span class="spin" style="width:12px;height:12px;vertical-align:-1px;margin-right:6px"></span>Reading the screenshot on your phone…';
  try {
    if (!ocrLib) {
      await new Promise((ok, fail) => {
        const sc = document.createElement('script');
        sc.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
        sc.onload = ok; sc.onerror = fail;
        document.head.appendChild(sc);
      });
      ocrLib = window.Tesseract;
    }
    const { data } = await ocrLib.recognize(file, 'eng');
    const text = data.text.replace(/[ \t]+\n/g, '\n').trim();
    if (!text) throw new Error('no text');
    $('sheet-text').value = text;
    sheetHow = 'screenshot';
    $('sheet-status').textContent = 'Check the text above, then send.';
  } catch {
    $('sheet-status').textContent = "Couldn't read that image. Try pasting the text instead.";
  }
}
$('sheet-file').onchange = (e) => { const f = e.target.files?.[0]; if (f) readImage(f); e.target.value = ''; };

// Android "Share → Detour": the service worker keeps what was shared and opens /traveller?shared.
async function pickUpShared() {
  if (!params.has('shared') || !('caches' in window)) return;
  const cache = await caches.open('detour-share');
  const textRes = await cache.match('/shared/text');
  const imageRes = await cache.match('/shared/image');
  await cache.delete('/shared/text');
  await cache.delete('/shared/image');
  history.replaceState(null, '', '/traveller');
  const wait = setInterval(() => {
    if (!INV || !S) return;
    clearInterval(wait);
    openSheet(textRes ? '' : '', 'shared');
    if (textRes) textRes.text().then((t) => { $('sheet-text').value = t; });
    if (imageRes) imageRes.blob().then(readImage);
  }, 200);
}

connect(render);
start().then(pickUpShared);
// ?tab=<view> opens a screen directly (used by the demo page and for screenshots).
if (params.get('tab')) setTimeout(() => INV && go(params.get('tab'), { replace: true }), 300);
