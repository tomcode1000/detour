// Detour travel manager app (phone): trips, decisions, payments, log and policy.
// Shared helpers come from mobile.js.
let S = null;
let logFilter = 'all';
const seen = new Set();
try { localStorage.setItem('detour.role', 'manager'); } catch {}

const first = () => S.traveller.name.split(' ')[0];
const PILL = { SENT: '<span class="pill ok">Paid</span>', SCHEDULED: '<span class="pill warn">Scheduled</span>', CANCELLED: '<span class="pill plain">Cancelled</span>' };

function render(s) {
  S = s;
  const tz = s.tz;
  const pending = s.approvals.filter((a) => a.status === 'PENDING');
  $('mg-badge').textContent = pending.length || '';
  renderHome(s, tz, pending);
  renderApprovals(s, tz);
  renderPayments(s, tz);
  renderLog(s, tz);
  renderPolicy(s);
  $('mg-fine').textContent = 'Demo: scripted flight feed and fictional test data. Payments run in the Airwallex sandbox.';
  DetourDock.update(s);
}

// ---------------------------------------------------------------- home
function tripStatus(s) {
  if (s.summary) return { cls: 'plain', text: 'Trip closed' };
  if (s.disruption && !s.disruption.closed) return { cls: 'warn', text: `Disrupted · ${CITY[s.disruption.airport] || s.disruption.airport}` };
  if (s.disruption?.closed) return { cls: 'info', text: 'In the air' };
  return { cls: 'ok', text: 'On track' };
}

function renderHome(s, tz, pending) {
  const h = Number(fmt(s.clock, tz, { hour: '2-digit' }));
  const hello = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const disrupted = s.disruption && !s.disruption.closed && !s.summary ? 1 : 0;
  const total = 1 + (s.otherTrips || []).length;
  $('mg-greet').innerHTML = `<h1>${hello}, ${esc(s.manager.split(' ')[0])}</h1>
    <p>${esc(fmt(s.clock, tz, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }))} · ${total} trips · ${disrupted ? `<b class="warn-text">${disrupted} disrupted</b>` : 'all on track'}</p>`;

  $('mg-decision').innerHTML = pending.map((a) => `
    <button class="mg-banner" data-goto="approvals">
      <span class="mg-banner-dot"></span>
      <span><b>${esc(approvalTitle(a))} needs your decision</b><small>+${money(a.delta, a.to.currency)} · ${esc(first())} · tap to review</small></span>
      <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>
    </button>`).join('');

  const st = tripStatus(s);
  const c = s.card;
  const cur = c?.controls.currency || 'EUR';
  const pay = s.payments || [];
  const k = (rows) => sum(rows);
  let stats;
  if (s.mode === 'transfer') {
    stats = [
      ['Paid out', money(k(pay.filter((l) => l.status === 'SENT')), cur)],
      ['Scheduled', money(k(pay.filter((l) => l.status === 'SCHEDULED')), cur)],
      ['Never paid out', money(k(pay.filter((l) => l.status === 'CANCELLED')), cur), 'ok-text'],
      ['Covered until', c ? dayHm(c.controls.activeTo, tz) : '—'],
    ];
  } else {
    stats = [
      ['Left on card', c ? money(c.remaining, cur) : '—'],
      ['Spent', c ? money(c.spent, cur) : '—'],
      ['Blocked', String(s.transactions.filter((t) => t.status !== 'APPROVED').length)],
      ['Card expires', c ? dayHm(c.controls.activeTo, tz) : '—'],
    ];
  }
  const route = [s.legs[0]?.from, ...s.legs.map((l) => l.to)].map((x) => CITY[x] || x).join(' → ');
  $('mg-live').innerHTML = `
    <div class="tv-card-head"><h2>Live trip</h2><span class="pill ${st.cls}">${esc(st.text)}</span></div>
    <div class="mg-person"><div class="avatar">${esc(s.traveller.name.split(' ').map((p) => p[0]).join(''))}</div>
      <div><b>${esc(s.traveller.name)}</b><span>${esc(s.traveller.role)} · ${esc(route)}</span></div></div>
    <div class="mg-kpis">${stats.map(([l, v, cls]) => `<div><span>${l}</span><b class="${cls || ''}">${esc(v)}</b></div>`).join('')}</div>
    ${s.summary ? `<div class="mg-note ok">${esc(summaryText(s))}</div>` : ''}
    ${lastMessageHtml(s, tz)}`;

  $('mg-itinerary').innerHTML = `<div class="tv-card-head"><h2>Itinerary</h2><span>Flight status feed</span></div>` + s.legs.map((f) => `
    <div class="tv-row"><div class="l"><b>${esc(f.id)} · ${esc(f.from)} → ${esc(f.to)}</b><span>Departs ${esc(dayHm(f.est_dep, tz))}</span></div><div class="r">${flightPill(f)}</div></div>`).join('');

  $('mg-trips').innerHTML = `<div class="tv-card-head"><h2>Other trips</h2><span>watching</span></div>` + (s.otherTrips || []).map((t) => `
    <div class="tv-row"><div class="l"><b>${esc(t.name)}</b><span>${esc(t.route)} · ${esc(t.flight)} ${esc(t.when)}</span></div><div class="r"><span class="pill ok">On track</span></div></div>`).join('');
}

function lastMessageHtml(s, tz) {
  const writing = s.activity && /^(Messaging|Replying|Reading .*message)/.test(s.activity);
  const m = s.messages.at(-1);
  if (writing) return `<div class="mg-msg muted"><span class="spinner"></span>Detour is writing to ${esc(first())}…</div>`;
  if (!m) return `<div class="mg-msg muted">Detour writes to ${esc(first())} the moment the trip breaks.</div>`;
  return `<div class="mg-msg ${m.from === 'traveller' ? 'from' : ''}"><span>${m.from === 'traveller' ? esc(first()) : `Detour to ${esc(first())}`} · ${esc(hm(m.at, tz))}</span>${esc(m.text)}</div>`;
}

function flightPill(f) {
  if (f.status === 'CANCELLED') return '<span class="pill bad">Cancelled</span>';
  if (f.status === 'LANDED') return '<span class="pill plain">Landed</span>';
  if (f.status === 'DEPARTED') return '<span class="pill info">In the air</span>';
  if (/late/.test(f.statusText)) return `<span class="pill warn">${esc(f.statusText.replace('running ', ''))}</span>`;
  return '<span class="pill ok">On time</span>';
}

function summaryText(s) {
  const sm = s.summary;
  return sm.mode === 'transfer'
    ? `Trip closed. Sent ${money(sm.toTraveller, sm.currency)} to ${first()} and ${money(sm.toHotel, sm.currency)} to the hotel; ${money(sm.cancelled, sm.currency)} never paid out. No expense claim.`
    : `Trip closed. Spent ${money(sm.spent, sm.currency)} of ${money(sm.limit, sm.currency)}; ${sm.declined} payment(s) blocked.`;
}

// ---------------------------------------------------------------- approvals
function approvalTitle(a) {
  if (a.kind === 'nights') return `Night ${a.to.nights} in ${a.to.city}`;
  if (a.kind === 'issue') return 'Open funding';
  return 'Extra money';
}
function renderApprovals(s, tz) {
  const list = s.approvals.slice().reverse();
  if (!list.length) {
    $('mg-approvals').innerHTML = `<div class="appr-empty">Nothing needs you. Detour handles everything inside policy on its own.</div>`;
    return;
  }
  $('mg-approvals').innerHTML = list.map((a) => {
    const cls = { PENDING: 'warn', APPROVED: 'ok', DECLINED: 'bad' }[a.status] || 'plain';
    const label = a.status === 'PENDING' ? 'Needs decision' : a.status.charAt(0) + a.status.slice(1).toLowerCase();
    const to = a.to;
    const pays = s.mode === 'transfer'
      ? `${esc(first())}: meals and taxis${to.nights ? ` · hotel paid directly, ${to.nights} night${to.nights > 1 ? 's' : ''}` : ''}`
      : `${esc(to.categories.join(', '))}`;
    if (a.status !== 'PENDING') {
      return `<div class="appr compact"><b>${esc(approvalTitle(a))}</b><span class="pill ${cls}">${label}</span><span class="appr-when">${esc(dayHm(a.decidedAt || a.at, tz))}</span></div>`;
    }
    return `<div class="appr pending">
      <div class="appr-head"><b>${esc(approvalTitle(a))}</b><span class="pill ${cls}">${label}</span></div>
      <div class="appr-why">${esc(a.why)}.</div>
      <dl class="bound">
        <dt>Amount</dt><dd>+${money(a.delta, to.currency)} <span style="color:var(--muted);font-weight:400">→ ${money(to.limit, to.currency)}</span></dd>
        <dt>Pays</dt><dd>${pays}</dd>
        <dt>Until</dt><dd>${esc(dayHm(to.activeTo, tz))}</dd>
      </dl>
      <div class="evidence">Evidence<ul>
        ${a.evidence.flights.map((f) => `<li>${esc(f.id)} ${esc(f.from)}→${esc(f.to)}: ${esc(f.status)}</li>`).join('')}
        ${a.evidence.emails.map((e) => `<li>Airline: “${esc(e.subject)}”${e.agrees ? '' : ' (feed does not confirm)'}</li>`).join('')}
        ${a.evidence.traveller.map((t) => `<li>${esc(first())}: “${esc(t)}”</li>`).join('')}
      </ul></div>
      <div class="appr-actions"><button class="btn lg-touch" data-decline="${a.id}">Decline</button><button class="btn primary lg-touch" data-approve="${a.id}">Approve</button></div>
    </div>`;
  }).join('');
}
document.addEventListener('click', (e) => {
  const yes = e.target.closest('[data-approve]');
  const no = e.target.closest('[data-decline]');
  if (!yes && !no) return;
  (yes || no).closest('.appr-actions').querySelectorAll('button').forEach((b) => { b.disabled = true; });
  api('/api/decide', { id: yes ? yes.dataset.approve : no.dataset.decline, decision: yes ? 'approve' : 'decline' });
});

// ---------------------------------------------------------------- payments
function renderPayments(s, tz) {
  $('mg-pay-intro').textContent = s.mode === 'transfer'
    ? `Through ${s.adapters.funding}. Later days are scheduled, so they can be cancelled if the trip ends sooner.`
    : `Card payments through ${s.adapters.funding}.`;
  const pay = s.payments || [];
  const cur = s.card?.controls.currency || 'EUR';
  if (s.mode === 'transfer') {
    const fees = sum(pay.filter((l) => l.status === 'SENT'), (l) => l.fee || 0);
    $('mg-pay-stats').innerHTML = [
      ['To traveller', money(sum(pay.filter((l) => l.status === 'SENT' && l.role === 'traveller')), cur)],
      ['To hotel', money(sum(pay.filter((l) => l.status === 'SENT' && l.role === 'hotel')), cur)],
      ['Fees', money(fees, cur)],
    ].map(([l, v]) => `<div><span>${l}</span><b>${esc(v)}</b></div>`).join('');
  } else {
    $('mg-pay-stats').innerHTML = '';
  }
  if (s.mode !== 'transfer') {
    $('mg-payments').innerHTML = s.transactions.length
      ? s.transactions.slice().reverse().map((t) => `<div class="tv-row ${t.status === 'APPROVED' ? '' : 'off'}"><div class="l"><b>${esc(t.merchant)}</b><span>${esc(dayHm(t.at, tz))} · ${t.status === 'APPROVED' ? 'Approved' : esc(t.reason)}</span></div><div class="r"><b>${money(t.amount, t.currency)}</b></div></div>`).join('')
      : '<div class="appr-empty">No card payments yet.</div>';
    return;
  }
  $('mg-payments').innerHTML = pay.length ? pay.slice().reverse().map((l) => {
    const key = `${l.id}:${l.status}`;
    const fresh = !seen.has(key);
    seen.add(key);
    const when = l.status === 'SCHEDULED' ? `Due ${dayHm(l.payAt, tz)}` : l.status === 'CANCELLED' ? 'Not needed' : `Paid ${dayHm(l.payAt, tz)}`;
    const fx = l.received && l.received.currency !== l.currency ? ` · ${money(l.received.amount, l.received.currency)} received` : '';
    return `<div class="tv-row ${l.status === 'CANCELLED' ? 'off' : ''} ${fresh ? 'fresh' : ''}">
      <div class="l"><b>${esc(l.what)}</b><span>${l.role === 'hotel' ? esc(l.payeeName) : esc(S.traveller.name)} · ${esc(when)}${esc(fx)}</span></div>
      <div class="r"><b>${money(l.amount, l.currency)}</b>${PILL[l.status] || ''}</div></div>`;
  }).join('') : '<div class="appr-empty">No payments yet. They appear the moment a trip is disrupted.</div>';
}

// ---------------------------------------------------------------- log
const TAG = { story: 'Story', feed: 'Flight feed', inbox: 'Inbox', rules: 'Rules', money: 'Payment', card: 'Card', agent: 'Agent', manager: 'Manager', merchant: 'Merchant', error: 'Error' };
const FILTERS = [['all', 'All'], ['rules', 'Decisions'], ['money', 'Payments'], ['agent', 'Agent'], ['feed', 'Flights']];
function renderLog(s, tz) {
  $('mg-filters').innerHTML = FILTERS.map(([k, l]) => `<button class="chip-btn ${logFilter === k ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('');
  const rows = s.log.filter((l) => logFilter === 'all' || l.source === logFilter || (logFilter === 'money' && l.source === 'card')).slice().reverse();
  $('mg-log').innerHTML = rows.length
    ? rows.map((l) => `<div class="mg-log"><div><span class="tag ${l.source}">${TAG[l.source] || esc(l.source)}</span><time>${esc(dayHm(l.at, tz))}</time></div><p>${esc(l.text)}</p></div>`).join('')
    : '<div class="appr-empty">Nothing yet.</div>';
}
document.addEventListener('click', (e) => {
  const f = e.target.closest('[data-filter]');
  if (f) { logFilter = f.dataset.filter; if (S) renderLog(S, S.tz); }
});

// ---------------------------------------------------------------- policy
function renderPolicy(s) {
  const r = s.policy.rules;
  const rules = [
    ['Disruption', `${r.delay_threshold_hours}h+ delay, a cancellation, or a connection under ${r.min_connection_minutes} min`],
    ['Nights', `Counted at ${r.overnight_cutoff_local} local time`],
    ['Automatic', `${r.auto_nights} night; extras up to ${r.max_auto_raise_pct}%`],
    ['Your approval', `Night ${r.auto_nights + 1}+, or extras above ${r.max_auto_raise_pct}%`],
    ['Cover ends', `${r.rebook_buffer_hours}h after the next confirmed flight`],
    ['Hotel', `City rate × ${r.lodging_factor}, paid to the hotel`],
  ];
  $('mg-rules').innerHTML = `<div class="tv-card-head"><h2>Rules</h2><span>${esc(company(s))}</span></div>` +
    rules.map(([k, v]) => `<div class="tv-row"><div class="l"><span>${k}</span><b>${esc(v)}</b></div></div>`).join('');
  $('mg-rates').innerHTML = `<div class="tv-card-head"><h2>City rates</h2><span>demo values</span></div>` +
    Object.entries(s.policy.cities).map(([code, c]) => `<div class="tv-row"><div class="l"><b>${esc(c.city)}</b><span>${esc(code)}${c.hotel ? ` · ${esc(c.hotel)}` : ''}</span></div>
      <div class="r"><b>${money(c.meals_per_day, c.currency)}</b><span>meals/day · hotel ${money(c.lodging_per_night, c.currency)}</span></div></div>`).join('');
  const liveMoney = s.adapters.fundingName.startsWith('airwallex');
  const liveAgent = s.adapters.agentName === 'deepseek';
  $('mg-connections').innerHTML = `<div class="tv-card-head"><h2>Connections</h2><span></span></div>
    <div class="tv-row"><div class="l"><b>Money</b><span>${esc(s.adapters.funding)}</span></div><div class="r"><span class="pill ${liveMoney ? 'ok' : 'warn'}">${liveMoney ? 'Live' : 'Simulated'}</span></div></div>
    <div class="tv-row"><div class="l"><b>Agent</b><span>${esc(s.adapters.agent)}</span></div><div class="r"><span class="pill ${liveAgent ? 'ok' : 'warn'}">${liveAgent ? 'Live' : 'Stand-in'}</span></div></div>`;
}

setupTabs(params.get('tab') || 'home', () => { if (S) render(S); });
DetourDock.mount();
connect(render);
