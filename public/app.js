// Detour demo page: renders the engine snapshot pushed over /events.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null;
let logFilter = 'all';
const seenPayments = new Set();

// ---------------------------------------------------------------- formatting
const moneyFmt = new Map();
function money(n, cur) {
  if (n == null || !cur) return '—';
  if (!moneyFmt.has(cur)) moneyFmt.set(cur, new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }));
  return moneyFmt.get(cur).format(n);
}
// Big number with smaller cents, e.g. €180<span>.00</span>
function bigMoney(n, cur) {
  const s = money(n, cur);
  const m = s.match(/^(.*?)([.,]\d{2})(\D*)$/);
  return m ? `${esc(m[1])}<span class="cents">${esc(m[2])}</span>${esc(m[3])}` : esc(s);
}
const fmt = (ms, tz, opts) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', ...opts }).format(new Date(ms));
const hm = (ms, tz) => fmt(ms, tz, { hour: '2-digit', minute: '2-digit' });
const dayHm = (ms, tz) => fmt(ms, tz, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const longWhen = (ms, tz) => fmt(ms, tz, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const first = () => S.traveller.name.split(' ')[0];
const sum = (rows) => rows.reduce((a, l) => a + l.amount, 0);

const CITY = { SIN: 'Singapore', FRA: 'Frankfurt', LHR: 'London' };
const TZ_CITY = { 'Europe/Berlin': 'Frankfurt', 'Europe/London': 'London', 'Asia/Singapore': 'Singapore' };

// ---------------------------------------------------------------- server calls
async function post(path, body) {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const json = await res.json();
    if (!json.ok) toast(json.error || 'Something went wrong.');
    return json;
  } catch {
    toast('Lost connection to the Detour server.');
    return { ok: false };
  }
}
let toastTimer;
window.DetourToast = toast;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}

// ---------------------------------------------------------------- render
function render(s) {
  S = s;
  const tz = s.tz;
  const transfer = s.mode === 'transfer';

  // Shell
  $('org-name').textContent = s.company.replace(/\s*\(.*\)/, '');
  $('crumb-name').textContent = s.traveller.name;
  $('trip-name').textContent = s.traveller.name;
  $('trip-route').textContent = routeText(s);
  setStatusPill(s);
  $('clock').textContent = longWhen(s.clock, tz);
  $('clockzone').textContent = `${TZ_CITY[tz] || tz.split('/')[1].replace('_', ' ')} time`;
  const pending = s.approvals.filter((a) => a.status === 'PENDING').length;
  $('nav-approvals').textContent = pending || '';
  const liveMoney = s.adapters.fundingName.startsWith('airwallex');
  setConn('conn-funding', liveMoney ? 'Airwallex sandbox' : 'Simulated money', s.mode === 'transfer' ? 'Transfers' : 'Virtual card', liveMoney, s.adapters.funding);
  const liveAgent = s.adapters.agentName === 'deepseek';
  setConn('conn-agent', liveAgent ? 'DeepSeek' : 'Stand-in agent', liveAgent ? s.adapters.agent.replace(/^DeepSeek \((.*)\)$/, '$1') : 'No model key', liveAgent, s.adapters.agent);
  $('foot').textContent = `${s.note} ${s.ratesNote}`;

  // What Detour is doing right now
  $('activity').innerHTML = s.activity ? `<span class="spinner"></span>${esc(s.activity)}…` : '';
  DetourDock.update(s);

  renderKpis(s, tz, transfer);
  renderItinerary(s, tz);
  renderMoney(s, tz, transfer);
  renderLog($('log-short'), s.log.slice(-7), tz);
  renderApprovals($('approvals-short'), s, tz, true);
  $('manager-meta').textContent = `${s.manager} · travel manager`;
  renderTraveller(s, tz);
  renderTrips(s, tz);

  renderApprovals($('approvals-full'), s, tz, false);
  renderPaymentsFull(s, tz, transfer);
  renderLogFull(s, tz);
  renderPolicy(s);
}

function routeText(s) {
  const stops = [s.legs[0]?.from, ...s.legs.map((l) => l.to)].filter(Boolean);
  return stops.map((c) => CITY[c] || c).join(' → ');
}

function setStatusPill(s) {
  const pill = $('trip-status');
  let cls = 'ok';
  let text = 'On track';
  if (s.summary) { cls = 'plain'; text = 'Trip closed'; }
  else if (s.disruption && !s.disruption.closed) { cls = 'warn'; text = `Disrupted · ${CITY[s.disruption.airport] || s.disruption.airport}`; }
  else if (s.disruption?.closed) { cls = 'info'; text = 'In the air'; }
  pill.className = `pill ${cls}`;
  pill.textContent = text;
}

function setConn(id, label, sub, live, full) {
  const el = $(id);
  el.classList.toggle('live', live);
  el.querySelector('.conn-text').textContent = label;
  el.querySelector('small').textContent = sub;
  el.title = `${full} (${live ? 'live' : 'simulated'})`;
}

// KPI strip
function renderKpis(s, tz, transfer) {
  const c = s.card;
  const cur = c?.controls.currency || 'EUR';
  let tiles;
  if (transfer) {
    const pay = s.payments || [];
    const sent = pay.filter((l) => l.status === 'SENT');
    const sched = pay.filter((l) => l.status === 'SCHEDULED');
    const cancelled = pay.filter((l) => l.status === 'CANCELLED');
    tiles = [
      { label: 'Paid out', value: bigMoney(sum(sent), cur), sub: `${sent.length} payment${sent.length === 1 ? '' : 's'} · to ${esc(first())} and the hotel` },
      { label: 'Scheduled · cancellable', value: bigMoney(sum(sched), cur), sub: sched.length ? `next ${esc(dayHm(Math.min(...sched.map((l) => l.payAt)), tz))}` : 'nothing pending' },
      { label: 'Never paid out', value: bigMoney(sum(cancelled), cur), sub: 'cancelled before payment', cls: cancelled.length ? 'saved' : '' },
      { label: 'Covered until', value: c ? esc(dayHm(c.controls.activeTo, tz)) : '—', sub: c ? `${c.controls.nights} night${c.controls.nights === 1 ? '' : 's'} · ${esc(c.controls.city)}` : 'no disruption' },
    ];
  } else {
    tiles = [
      { label: 'Left on card', value: c ? bigMoney(c.remaining, cur) : '—', sub: c ? `of ${money(c.controls.limit, cur)}` : 'no card yet' },
      { label: 'Spent', value: c ? bigMoney(c.spent, cur) : '—', sub: `${s.transactions.filter((t) => t.status === 'APPROVED').length} approved` },
      { label: 'Blocked', value: String(s.transactions.filter((t) => t.status !== 'APPROVED').length), sub: 'payments declined' },
      { label: 'Card expires', value: c ? esc(dayHm(c.controls.activeTo, tz)) : '—', sub: c ? esc(c.status.toLowerCase()) : '' },
    ];
  }
  $('kpis').innerHTML = tiles.map((t) => `<div class="kpi ${t.cls || ''}"><div class="kpi-label">${t.label}</div><div class="kpi-value">${t.value}</div><div class="kpi-sub">${t.sub}</div></div>`).join('');
}

// Itinerary
function flightPill(f) {
  const t = f.statusText;
  if (f.status === 'CANCELLED') return '<span class="pill bad">Cancelled</span>';
  if (f.status === 'LANDED') return '<span class="pill plain">Landed</span>';
  if (f.status === 'DEPARTED') return `<span class="pill info">${esc(t.replace('in the air', 'In the air'))}</span>`;
  if (/late/.test(t)) return `<span class="pill warn">${esc(t.replace('running', 'Running'))}</span>`;
  return '<span class="pill ok">On time</span>';
}
function renderItinerary(s, tz) {
  $('itinerary').innerHTML = `<div class="legs">${s.legs.map((f) => `
    <div class="leg">
      <div><div class="leg-code">${esc(f.id)}</div><div class="leg-time">${esc(dayHm(f.est_dep, tz))}</div></div>
      <div class="leg-route"><span class="ap">${esc(f.from)}</span><span class="line"></span><span class="ap">${esc(f.to)}</span>
        <span class="leg-time">${esc(CITY[f.from] || f.from)} to ${esc(CITY[f.to] || f.to)}</span></div>
      <div>${flightPill(f)}</div>
    </div>`).join('')}</div>`;
}

// Payment plan (transfers) or card payments
const STATUS_PILL = { SENT: '<span class="pill ok">Paid</span>', SCHEDULED: '<span class="pill warn">Scheduled</span>', CANCELLED: '<span class="pill plain">Cancelled</span>' };
const DECLINE = {
  MERCHANT_CATEGORY_NOT_ALLOWED: 'Merchant type not allowed',
  LIMIT_EXCEEDED: 'Over the limit',
  OUT_OF_ALLOWED_TIME_RANGE: 'Outside active time',
  CURRENCY_NOT_ALLOWED: 'Wrong currency',
  CARD_INACTIVE: 'Card switched off',
  CARD_CLOSED: 'Card closed',
};
const MCC_NAMES = { 5812: 'Restaurant', 5814: 'Fast food', 4121: 'Taxi', 4111: 'Local transport', 7011: 'Hotel', 5813: 'Bar', 5732: 'Electronics' };

function paymentRows(pay, tz, full) {
  return pay.slice().reverse().map((l) => {
    const key = `${l.id}:${l.status}`;
    const isNew = !seenPayments.has(key);
    seenPayments.add(key);
    const when = l.status === 'SCHEDULED' ? `due ${dayHm(l.payAt, tz)}` : l.status === 'CANCELLED' ? 'not needed' : dayHm(l.payAt, tz);
    const fx = l.received && l.received.currency !== l.currency ? money(l.received.amount, l.received.currency) : '';
    return `<tr class="${l.status === 'CANCELLED' ? 'cancelled' : ''} ${isNew ? 'fresh' : ''}">
      <td><span class="who"><i class="${l.role === 'hotel' ? 'hotel' : ''}">${l.role === 'hotel' ? 'H' : esc(first()[0])}</i><span>${esc(l.what)}<span class="sub">${l.role === 'hotel' ? esc(l.payeeName) : `${esc(S.traveller.name)} · bank account`}</span></span></span></td>
      <td>${STATUS_PILL[l.status] || esc(l.status)}<span class="sub">${esc(when)}</span></td>
      ${full ? `<td class="r">${l.fee != null ? money(l.fee, l.currency) : '—'}</td><td><span class="mono">${esc(String(l.id).slice(0, 8))}</span></td>` : ''}
      <td class="r amt"><b>${money(l.amount, l.currency)}</b>${fx ? `<span class="sub">${esc(fx)} received</span>` : ''}</td>
    </tr>`;
  }).join('');
}

function renderMoney(s, tz, transfer) {
  $('buy-form').hidden = transfer || !s.card;
  $('money-title').textContent = transfer ? 'Payment plan' : 'Card payments';
  $('money-meta').textContent = s.adapters.funding;
  const summary = summaryHtml(s);
  if (transfer) {
    const pay = s.payments || [];
    $('money-table').innerHTML = (pay.length
      ? `<div class="table-wrap"><table><thead><tr><th>Payment</th><th>Status</th><th class="r">Amount</th></tr></thead><tbody>${paymentRows(pay, tz, false)}</tbody></table></div>`
      : `<div class="empty"><b>Nothing paid yet</b>Detour is watching ${esc(first())}'s flights. Nothing to do while the trip is on track.</div>`) + summary;
    return;
  }
  const tx = s.transactions;
  $('money-table').innerHTML = (tx.length
    ? `<div class="table-wrap"><table><thead><tr><th>Merchant</th><th>Status</th><th class="r">Amount</th></tr></thead><tbody>${tx.slice().reverse().map((t) => `
      <tr class="${t.status === 'APPROVED' ? '' : 'cancelled'}"><td>${esc(t.merchant)}<span class="sub">${esc(MCC_NAMES[t.mcc] || `MCC ${t.mcc}`)} · ${esc(dayHm(t.at, tz))}${t.incrementOf ? ' · top-up' : ''}</span></td>
      <td>${t.status === 'APPROVED' ? '<span class="pill ok">Approved</span>' : `<span class="pill bad">Declined</span><span class="sub">${esc(DECLINE[t.reason] || t.reason)}</span>`}</td>
      <td class="r amt"><b>${money(t.amount, t.currency)}</b></td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty"><b>No card payments yet</b>${s.card ? 'The card is ready to use.' : 'A card appears the moment the trip is disrupted.'}</div>`) + summary;
}

function summaryHtml(s) {
  const sm = s.summary;
  if (!sm) return '';
  if (sm.mode === 'transfer') {
    return `<div class="summary"><b>Trip closed.</b> Sent ${money(sm.toTraveller, sm.currency)} to ${esc(first())} and ${money(sm.toHotel, sm.currency)} straight to the hotel. ${money(sm.cancelled, sm.currency)} was scheduled but never paid out. No receipts, no expense claim.</div>`;
  }
  return `<div class="summary"><b>Trip closed.</b> Spent ${money(sm.spent, sm.currency)} of ${money(sm.limit, sm.currency)}. ${sm.declined} payment${sm.declined === 1 ? '' : 's'} blocked. No receipts needed.</div>`;
}

// Approvals
function approvalTitle(a) {
  if (a.kind === 'nights') return `Night ${a.to.nights} in ${a.to.city}`;
  if (a.kind === 'issue') return 'Open funding';
  return `Extra for ${first()}`;
}
function renderApprovals(el, s, tz, compactHistory) {
  const list = s.approvals.slice().reverse();
  if (!list.length) {
    el.innerHTML = `<div class="appr-empty">Nothing needs ${esc(s.manager)}. Detour handles everything inside policy on its own.</div>`;
    return;
  }
  el.innerHTML = list.map((a) => {
    const statePill = { PENDING: 'warn', APPROVED: 'ok', DECLINED: 'bad', STALE: 'plain', WITHDRAWN: 'plain' }[a.status];
    const label = { PENDING: 'Needs decision' }[a.status] || a.status.charAt(0) + a.status.slice(1).toLowerCase();
    if (compactHistory && a.status !== 'PENDING') {
      return `<div class="appr compact"><b>${esc(approvalTitle(a))}</b><span class="pill ${statePill}">${label}</span><span class="appr-when">${esc(dayHm(a.decidedAt || a.at, tz))}</span></div>`;
    }
    const to = a.to;
    const pays = s.mode === 'transfer'
      ? `${esc(first())}: meals and taxis${to.nights ? ` · hotel paid directly, ${to.nights} night${to.nights > 1 ? 's' : ''}` : ''}`
      : `${esc(to.categories.join(', '))} (MCC ${esc(to.mccs.join(', '))})`;
    return `<div class="appr ${a.status === 'PENDING' ? 'pending' : ''}">
      <div class="appr-head"><b>${esc(approvalTitle(a))}</b><span class="pill ${statePill}">${label}</span></div>
      <div class="appr-why">${esc(a.why)}.</div>
      <dl class="bound">
        <dt>Amount</dt><dd>+${money(a.delta, to.currency)} <span style="color:var(--muted);font-weight:400">→ ${money(to.limit, to.currency)} total</span></dd>
        <dt>Pays</dt><dd>${pays}</dd>
        <dt>Until</dt><dd>${esc(dayHm(to.activeTo, tz))}</dd>
      </dl>
      <div class="evidence">Evidence<ul>
        ${a.evidence.flights.map((f) => `<li>${esc(f.id)} ${esc(f.from)}→${esc(f.to)}: ${esc(f.status)}, departs ${esc(dayHm(f.est_dep, tz))}</li>`).join('')}
        ${a.evidence.emails.map((e) => `<li>Airline: “${esc(e.subject)}” (${e.agrees ? 'feed agrees' : 'feed does not confirm'})</li>`).join('')}
        ${a.evidence.traveller.map((t) => `<li>${esc(first())}: “${esc(t)}”</li>`).join('')}
      </ul></div>
      ${a.status === 'PENDING' ? `<div class="appr-actions"><button class="btn" data-decline="${a.id}">Decline</button><button class="btn primary" data-approve="${a.id}">Approve</button></div>` : ''}
    </div>`;
  }).join('');
}

// Traveller panel: what Ada has been told, and her latest message.
function renderTraveller(s, tz) {
  $('trav-meta').textContent = s.traveller.role;
  const last = (from) => s.messages.filter((m) => m.from === from).at(-1);
  const toAda = last('detour');
  const fromAda = last('traveller');
  const writing = s.activity && /^(Messaging|Replying|Reading .*message)/.test(s.activity);
  const initials = s.traveller.name.split(' ').map((p) => p[0]).join('');
  $('trav-card').innerHTML = `
    <div class="trav">
      <div class="trav-who"><div class="avatar">${esc(initials)}</div><div><b>${esc(s.traveller.name)}</b><span class="sub">${s.messages.length} message${s.messages.length === 1 ? '' : 's'} · sent to the traveller app</span></div></div>
      ${writing ? '<div class="trav-msg muted"><span class="spinner"></span> Detour is writing…</div>' : ''}
      ${toAda ? `<div class="trav-msg"><span class="trav-label">Detour · ${esc(hm(toAda.at, tz))}</span>${esc(toAda.text)}</div>` : `<div class="trav-msg muted">No messages yet. Detour writes the moment the trip breaks.</div>`}
      ${fromAda && fromAda.at >= (toAda?.at ?? 0) - 6e5 ? `<div class="trav-msg from"><span class="trav-label">${esc(first())} · ${esc(hm(fromAda.at, tz))}</span>${esc(fromAda.text)}</div>` : ''}
    </div>`;
}

// Trips list: the live trip plus the others Detour is watching.
function renderTrips(s, tz) {
  const live = {
    name: s.traveller.name, route: routeText(s), flight: s.legs.find((l) => l.status !== 'LANDED') || s.legs.at(-1),
    status: $('trip-status').textContent, cls: $('trip-status').className.replace('pill', '').trim(), live: true,
  };
  const others = (s.otherTrips || []).map((t) => ({ ...t, cls: 'ok' }));
  $('trips').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Traveller</th><th>Route</th><th>Next flight</th><th>Status</th><th class="r">Detour</th></tr></thead><tbody>
    <tr class="row-link" data-goto="overview"><td><b>${esc(live.name)}</b><span class="sub">${esc(s.traveller.role)}</span></td><td>${esc(live.route)}</td>
      <td>${esc(live.flight.id)}<span class="sub">${esc(dayHm(live.flight.est_dep, tz))}</span></td><td><span class="pill ${live.cls}">${esc(live.status)}</span></td>
      <td class="r">${s.card ? `<b>${money(sum((s.payments || []).filter((p) => p.status === 'SENT')) || s.card.spent || 0, s.card.controls.currency)}</b><span class="sub">paid out</span>` : '<span class="sub">Watching</span>'}</td></tr>
    ${others.map((t) => `<tr><td><b>${esc(t.name)}</b><span class="sub">${esc(t.role)}</span></td><td>${esc(t.route)}</td><td>${esc(t.flight)}<span class="sub">${esc(t.when)}</span></td><td><span class="pill ok">On track</span></td><td class="r"><span class="sub">Watching</span></td></tr>`).join('')}
  </tbody></table></div>`;
}

// Log
const TAG = { story: 'Story', feed: 'Flight feed', rules: 'Rules', money: 'Payment', card: 'Card', agent: 'Agent', manager: 'Manager', merchant: 'Merchant', error: 'Error' };
function renderLog(el, rows, tz) {
  el.innerHTML = rows.length
    ? rows.map((l) => `<li><time>${hm(l.at, tz)}</time><span class="tag ${l.source}">${TAG[l.source] || esc(l.source)}</span><span>${esc(l.text)}</span></li>`).join('')
    : '<li style="display:block;color:var(--muted)">Nothing yet.</li>';
}
const FILTERS = [['all', 'All'], ['rules', 'Decisions'], ['money', 'Payments'], ['agent', 'Agent'], ['feed', 'Flight feed'], ['manager', 'Manager']];
function renderLogFull(s, tz) {
  $('log-filters').innerHTML = FILTERS.map(([k, label]) => `<button class="chip-btn ${logFilter === k ? 'on' : ''}" data-filter="${k}">${label}</button>`).join('');
  const rows = s.log.filter((l) => logFilter === 'all' || l.source === logFilter || (logFilter === 'money' && l.source === 'card'));
  renderLog($('log-full'), rows, tz);
}

// Payments page
function renderPaymentsFull(s, tz, transfer) {
  $('payments-intro').textContent = transfer
    ? `Every payment Detour has made, scheduled or cancelled through ${s.adapters.funding}. Later days are scheduled, not sent, so they can be cancelled if the trip ends sooner.`
    : `Every charge on the Detour card through ${s.adapters.funding}.`;
  const pay = s.payments || [];
  $('payments-full').innerHTML = transfer && pay.length
    ? `<div class="table-wrap"><table><thead><tr><th>Payment</th><th>Status</th><th class="r">Fee</th><th>Transfer ID</th><th class="r">Amount</th></tr></thead><tbody>${paymentRows(pay, tz, true)}</tbody></table></div>${summaryHtml(s)}`
    : '<div class="empty"><b>No payments yet</b>They appear here as soon as a trip is disrupted.</div>';
}

// Policy page
function renderPolicy(s) {
  const p = s.policy;
  const r = p.rules;
  const rows = [
    ['Disruption', `A delay of ${r.delay_threshold_hours}h or more, a cancellation, or a connection under ${r.min_connection_minutes} min`],
    ['Nights', `Counted at ${r.overnight_cutoff_local} local time before the next confirmed flight`],
    ['Automatic', `Up to ${r.auto_nights} night${r.auto_nights === 1 ? '' : 's'}; extras up to ${r.max_auto_raise_pct}% of the current amount`],
    ['Needs approval', `Night ${r.auto_nights + 1} onwards, or any extra above ${r.max_auto_raise_pct}%`],
    ['Ends', `${r.rebook_buffer_hours}h after the next confirmed departure (${r.provisional_hours}h at a time while none is confirmed)`],
    ['Hotel', `City rate × ${r.lodging_factor}, paid directly to the hotel`],
  ];
  $('policy').innerHTML = `
    <div class="card"><div class="card-head"><h2>Rules</h2><span class="meta">${esc(s.manager)} approves exceptions</span></div>
      <table><tbody>${rows.map(([k, v]) => `<tr><td style="width:150px;color:var(--muted)">${k}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>
    <div class="card"><div class="card-head"><h2>City rates</h2><span class="meta">Demo values</span></div>
      <div class="table-wrap"><table><thead><tr><th>City</th><th class="r">Meals / day</th><th class="r">Taxis</th><th class="r">Hotel / night</th></tr></thead><tbody>
      ${Object.entries(p.cities).map(([code, c]) => `<tr><td>${esc(c.city)}<span class="sub">${esc(code)}${c.hotel ? ` · ${esc(c.hotel)}` : ''}</span></td><td class="r">${money(c.meals_per_day, c.currency)}</td><td class="r">${money(c.transport, c.currency)}</td><td class="r">${money(c.lodging_per_night, c.currency)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
}

// ---------------------------------------------------------------- views and input
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  try { localStorage.setItem('detour.view', name); } catch {}
  window.scrollTo({ top: 0 });
}
$('nav').onclick = (e) => { const b = e.target.closest('button[data-view]'); if (b) showView(b.dataset.view); };
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-goto]');
  if (go) showView(go.dataset.goto);
  const f = e.target.closest('[data-filter]');
  if (f) { logFilter = f.dataset.filter; if (S) renderLogFull(S, S.tz); }
  const yes = e.target.closest('[data-approve]');
  const no = e.target.closest('[data-decline]');
  if (yes || no) {
    (yes || no).closest('.appr-actions').querySelectorAll('button').forEach((b) => { b.disabled = true; });
    post('/api/decide', { id: yes ? yes.dataset.approve : no.dataset.decline, decision: yes ? 'approve' : 'decline' });
  }
});

$('buy-form').onsubmit = (e) => {
  e.preventDefault();
  const mcc = $('buy-mcc').value;
  post('/api/purchase', { mcc, amount: $('buy-amount').value, currency: $('buy-cur').value, merchant: `${MCC_NAMES[mcc]} (test)` });
};
DetourDock.mount();

{
  let saved = new URLSearchParams(location.search).get('view');
  try { saved = saved || localStorage.getItem('detour.view'); } catch {}
  if (saved && document.querySelector(`.view[data-view="${saved}"]`)) showView(saved);
}

// ?snapshot loads the state once (for screenshots); otherwise stay live over Server-Sent Events.
if (new URLSearchParams(location.search).has('snapshot')) {
  fetch('/api/state').then((r) => r.json()).then(render);
} else {
  const events = new EventSource('/events');
  events.onmessage = (e) => render(JSON.parse(e.data));
  events.onerror = () => toast('Reconnecting to the Detour server…');
}
