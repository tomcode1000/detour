// Detour demo page: renders the engine snapshot pushed over /events.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, cur) => `${Number(n).toFixed(2)} ${cur || ''}`.trim();

let state = null;
let lastChatCount = 0;
let lastLogCount = 0;

function fmt(ms, tz, opts) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', ...opts }).format(new Date(ms));
}
const hm = (ms, tz) => fmt(ms, tz, { hour: '2-digit', minute: '2-digit' });
const dayHm = (ms, tz) => fmt(ms, tz, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return res.json();
}

const DECLINE = {
  MERCHANT_CATEGORY_NOT_ALLOWED: 'Merchant type not allowed on this card',
  LIMIT_EXCEEDED: 'Over the card limit',
  OUT_OF_ALLOWED_TIME_RANGE: 'Outside the card\'s active time',
  CURRENCY_NOT_ALLOWED: 'Wrong currency for this card',
  CARD_INACTIVE: 'Card switched off',
  CARD_CLOSED: 'Card closed',
};
const MCC_NAMES = { 5812: 'Restaurant', 5814: 'Fast food', 4121: 'Taxi', 4111: 'Local transport', 7011: 'Hotel', 5813: 'Bar', 5732: 'Electronics', 5691: 'Clothing' };

function render(s) {
  state = s;
  const tz = s.tz;
  $('clock').textContent = dayHm(s.clock, tz);
  $('clockzone').textContent = `${s.disruption ? s.legs[s.disruption.legIndex]?.from : 'FRA'} · ${tz.split('/')[1].replace('_', ' ')} time`;
  $('traveller-name').textContent = s.traveller.name;
  $('manager-name').textContent = `${s.manager} · travel manager`;

  const fundingWarn = s.adapters.fundingName !== 'airwallex';
  const agentWarn = s.adapters.agentName !== 'deepseek';
  $('badges').innerHTML = `
    <span class="badge ${fundingWarn ? 'warn' : 'ok'}">Funding: ${esc(s.adapters.funding)}</span>
    <span class="badge ${agentWarn ? 'warn' : 'ok'}">Agent: ${esc(s.adapters.agent)}</span>`;
  $('card-funding').textContent = s.adapters.funding;

  $('btn-step').disabled = s.busy || s.progress.finished || s.progress.waiting;
  $('btn-run').disabled = s.busy || s.progress.finished || s.progress.waiting;
  $('btn-step').textContent = s.progress.waiting ? 'Waiting for approval' : s.progress.finished ? 'Done' : `Next › (${s.progress.at}/${s.progress.total})`;

  $('scene').className = `scene${s.scene ? '' : ' empty'}`;
  $('scene').innerHTML = s.scene ? `<b>${esc(s.scene.name)}</b><span>${esc(s.scene.text)}</span>` : `<span>${esc(s.title)} — press Next to start.</span>`;

  renderChat(s, tz);
  renderFlights(s, tz);
  renderCard(s, tz);
  renderSpend(s, tz);
  renderApprovals(s, tz);
  renderLog(s, tz);
  $('foot').textContent = `${s.note} ${s.ratesNote} Company: ${s.company}.`;
}

function renderChat(s, tz) {
  const chat = $('chat');
  if (!s.messages.length) {
    chat.innerHTML = '<div class="chat-empty">Nothing yet. Detour messages Ada the moment her trip breaks.</div>';
    lastChatCount = 0;
    return;
  }
  chat.innerHTML = s.messages.map((m) => `<div class="bubble ${m.from}">${esc(m.text)}<time>${hm(m.at, tz)}</time></div>`).join('');
  if (s.messages.length !== lastChatCount) chat.scrollTop = chat.scrollHeight;
  lastChatCount = s.messages.length;
}

function renderFlights(s, tz) {
  $('flights').innerHTML = s.legs.map((f) => {
    const bad = f.status === 'CANCELLED' || /late/.test(f.statusText);
    const done = f.status === 'LANDED' || f.status === 'DEPARTED';
    return `<div class="flight ${bad ? 'bad' : done ? 'done' : ''}">
      <span><b>${esc(f.id)}</b> ${esc(f.from)} → ${esc(f.to)}<br><small>departs ${dayHm(f.est_dep, tz)}</small></span>
      <span class="st">${esc(f.statusText)}</span></div>`;
  }).join('');
}

function renderCard(s, tz) {
  const c = s.card;
  if (!c) {
    $('card').innerHTML = `<div class="card-empty">No card yet.<br><small>Detour is watching ${esc(s.traveller.name.split(' ')[0])}'s flights. Nothing to do while the trip is on track.</small></div>`;
  } else {
    const k = c.controls;
    const used = Math.min(100, (c.spent / k.limit) * 100);
    const live = c.status === 'ACTIVE';
    $('card').innerHTML = `
      <div class="vcard ${live ? '' : 'off'}">
        <div class="row"><span class="name">Detour · ${esc(s.traveller.name)}</span><span class="pill ${live ? 'live' : ''}">${esc(c.status === 'INACTIVE' ? 'SWITCHED OFF' : c.status)}</span></div>
        <div class="amount">${money(c.remaining, k.currency)}</div>
        <div class="left">left of ${money(k.limit, k.currency)} · ${esc(k.city)}</div>
        <div class="bar"><span style="width:${used}%"></span></div>
        <div class="row"><span>•••• ${esc(c.last4 || '----')}</span><span>until ${dayHm(k.activeTo, tz)}</span></div>
      </div>
      <div class="chips">${c.categoryLabels.map((l) => `<span class="chip">${esc(l)}</span>`).join('')}</div>
      <dl class="facts">
        <dt>Meals</dt><dd>${money(k.breakdown.meals, k.currency)}</dd>
        <dt>Taxis</dt><dd>${money(k.breakdown.transport, k.currency)}</dd>
        ${k.breakdown.lodging ? `<dt>Hotel</dt><dd>${money(k.breakdown.lodging, k.currency)} · ${k.nights} night${k.nights > 1 ? 's' : ''}</dd>` : ''}
        ${k.breakdown.extras ? `<dt>Approved extra</dt><dd>${money(k.breakdown.extras, k.currency)}</dd>` : ''}
        <dt>Merchant codes</dt><dd>${esc(k.mccs.join(', '))}</dd>
      </dl>`;
    $('buy-cur').value = k.currency;
  }
  const sm = s.summary;
  $('summary').innerHTML = sm ? `<div class="summary"><h4>Trip closed · spend summary</h4>
    Spent <b>${money(sm.spent, sm.currency)}</b> of ${money(sm.limit, sm.currency)} over ${sm.nights} night${sm.nights === 1 ? '' : 's'}.<br>
    ${Object.entries(sm.byCategory).map(([k, v]) => `${esc(k)}: ${money(v, sm.currency)}`).join(' · ')}<br>
    ${sm.declined} payment${sm.declined === 1 ? '' : 's'} blocked · ${sm.approvals} manager approval${sm.approvals === 1 ? '' : 's'} · no receipts needed.</div>` : '';
}

function renderSpend(s, tz) {
  if (!s.transactions.length) {
    $('spend').innerHTML = '<li class="none">No payments yet.</li>';
    return;
  }
  $('spend').innerHTML = s.transactions.slice().reverse().map((t) => {
    const ok = t.status === 'APPROVED';
    const what = MCC_NAMES[t.mcc] || `MCC ${t.mcc}`;
    return `<li class="${ok ? 'ok' : 'bad'}">
      <span>${esc(t.merchant)}</span><span class="amt">${money(t.amount, t.currency)}</span>
      <span class="why">${hm(t.at, tz)} · ${esc(what)}${t.incrementOf ? ' · top-up' : ''} · ${ok ? 'Approved' : esc(DECLINE[t.reason] || t.reason)}</span></li>`;
  }).join('');
}

function renderApprovals(s, tz) {
  const list = s.approvals.slice().reverse();
  if (!list.length) {
    $('approvals').innerHTML = `<p class="no-approvals">Nothing needs ${esc(s.manager)}. Detour handles everything inside policy on its own and only asks when it must.</p>`;
    return;
  }
  $('approvals').innerHTML = list.map((a) => {
    const to = a.to;
    const ev = a.evidence;
    return `<div class="approval ${a.status === 'PENDING' ? 'pending' : ''}">
      <div class="head"><b>${a.kind === 'nights' ? `Night ${to.nights} for ${esc(s.traveller.name.split(' ')[0])}` : a.kind === 'issue' ? 'New card' : 'Raise for ' + esc(s.traveller.name.split(' ')[0])}</b>
        <span class="state ${a.status}">${a.status}</span></div>
      <div class="why">${esc(a.why)}</div>
      <dl class="bound">
        <dt>Amount</dt><dd>+${money(a.delta, to.currency)} → limit ${money(to.limit, to.currency)}</dd>
        <dt>Merchants</dt><dd>${esc(to.categories.join(', '))} (${esc(to.mccs.join(', '))})</dd>
        <dt>Expires</dt><dd>${dayHm(to.activeTo, tz)}</dd>
      </dl>
      <div class="ev"><b>Evidence</b><ul>
        ${ev.flights.map((f) => `<li>${esc(f.id)} ${esc(f.from)}→${esc(f.to)}: ${esc(f.status)}, departs ${dayHm(f.est_dep, tz)}</li>`).join('')}
        ${ev.emails.map((e) => `<li>Airline email: “${esc(e.subject)}” ${e.agrees ? '(feed agrees)' : '(feed does not confirm)'}</li>`).join('')}
        ${ev.traveller.map((t) => `<li>${esc(s.traveller.name.split(' ')[0])}: “${esc(t)}”</li>`).join('')}
      </ul></div>
      ${a.status === 'PENDING' ? `<div class="act"><button class="yes" data-approve="${a.id}">Approve</button><button data-decline="${a.id}">Decline</button></div>` : ''}
    </div>`;
  }).join('');
}

function renderLog(s, tz) {
  const log = $('log');
  log.innerHTML = s.log.map((l) => `<li><time>${hm(l.at, tz)}</time><span class="src ${l.source}">${esc(l.source)}</span><span>${esc(l.text)}</span></li>`).join('');
  if (s.log.length !== lastLogCount) log.scrollTop = log.scrollHeight;
  lastLogCount = s.log.length;
}

// ---------------------------------------------------------------- wiring
$('btn-step').onclick = () => post('/api/step');
$('btn-run').onclick = () => post('/api/run');
$('btn-reset').onclick = () => post('/api/reset');
$('chat-form').onsubmit = (e) => {
  e.preventDefault();
  const text = $('chat-text').value.trim();
  if (!text) return;
  $('chat-text').value = '';
  post('/api/chat', { text });
};
$('buy-form').onsubmit = (e) => {
  e.preventDefault();
  const mcc = $('buy-mcc').value;
  post('/api/purchase', { mcc, amount: $('buy-amount').value, currency: $('buy-cur').value, merchant: `${MCC_NAMES[mcc]} (test)` });
};
$('approvals').onclick = (e) => {
  const id = e.target.dataset.approve || e.target.dataset.decline;
  if (id) post('/api/decide', { id, decision: e.target.dataset.approve ? 'approve' : 'decline' });
};

const events = new EventSource('/events');
events.onmessage = (e) => render(JSON.parse(e.data));
