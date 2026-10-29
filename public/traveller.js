// Detour traveller app: what the stranded traveller sees on their phone.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);
if (params.has('embed')) document.body.classList.add('embed');

const CITY = { SIN: 'Singapore', FRA: 'Frankfurt', LHR: 'London' };
const moneyFmt = new Map();
function money(n, cur) {
  if (n == null || !cur) return '—';
  if (!moneyFmt.has(cur)) moneyFmt.set(cur, new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }));
  return moneyFmt.get(cur).format(n);
}
const fmt = (ms, tz, opts) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', ...opts }).format(new Date(ms));
const hm = (ms, tz) => fmt(ms, tz, { hour: '2-digit', minute: '2-digit' });
const dayHm = (ms, tz) => fmt(ms, tz, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const sum = (rows, f = (l) => l.amount) => rows.reduce((a, l) => a + f(l), 0);

let S = null;
let screen = params.get('tab') === 'messages' ? 'messages' : 'trip';
let seen = 0;
let lastCount = 0;

let toastTimer;
window.DetourToast = (text) => {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
};

function render(s) {
  S = s;
  const tz = s.tz;
  $('tv-org').textContent = s.company.replace(/\s*\(.*\)/, '');
  renderHero(s, tz);
  renderFlight(s, tz);
  renderHotel(s);
  renderMoney(s, tz);
  renderChat(s, tz);
  $('tv-fine').textContent = 'Demo: scripted flight feed and fictional test data. Payments run in the Airwallex sandbox.';
  const fromDetour = s.messages.filter((m) => m.from === 'detour').length;
  if (screen === 'messages') seen = fromDetour;
  $('tv-badge').textContent = fromDetour > seen ? fromDetour - seen : '';
  DetourDock.update(s);
}

const toTraveller = (s) => (s.payments || []).filter((l) => l.role === 'traveller');
const hotelRows = (s) => (s.payments || []).filter((l) => l.role === 'hotel');

function renderHero(s, tz) {
  const el = $('tv-hero');
  const c = s.card;
  const dest = CITY[s.legs.at(-1)?.to] || s.legs.at(-1)?.to;
  if (s.summary) {
    el.className = 'tv-hero calm';
    const sm = s.summary;
    el.innerHTML = sm.mode === 'transfer'
      ? `<div class="eyebrow">Trip complete</div><h1>Welcome to ${esc(dest)}</h1><p>Detour sent you ${money(sm.toTraveller, sm.currency)} and paid your hotel directly. Nothing to claim, no receipts.</p>`
      : `<div class="eyebrow">Trip complete</div><h1>Welcome to ${esc(dest)}</h1><p>Your Detour card is closed. You spent ${money(sm.spent, sm.currency)}. Nothing to claim, no receipts.</p>`;
    return;
  }
  if (!c) {
    el.className = 'tv-hero calm';
    el.innerHTML = `<div class="eyebrow">Trip to ${esc(dest)}</div><h1>Your trip is on track</h1><p>Detour is watching your flights. If one is cancelled or badly delayed, money for meals, taxis and a hotel reaches you automatically.</p>`;
    return;
  }
  if (c.status !== 'ACTIVE') {
    el.className = 'tv-hero calm';
    el.innerHTML = `<div class="eyebrow">On your way</div><h1>Have a good flight</h1><p>Your Detour cover has ended. Anything you didn't need was cancelled before it was paid.</p>`;
    return;
  }
  const k = c.controls;
  const hotel = k.categories.includes('lodging');
  el.className = 'tv-hero covered';
  let big = '';
  if (s.mode === 'transfer') {
    const sent = toTraveller(s).filter((l) => l.status === 'SENT');
    const rec = sent.filter((l) => l.received);
    const cur = rec[0]?.received.currency || k.currency;
    big = `<div class="big">${money(sum(rec, (l) => l.received.amount), cur)}<small>in your account</small></div>`;
  } else {
    big = `<div class="big">${money(c.remaining, k.currency)}<small>left on your card</small></div>`;
  }
  el.innerHTML = `<div class="eyebrow">Disrupted · ${esc(k.city)}</div><h1>You're covered in ${esc(k.city)}</h1>
    <p>Meals and taxis${hotel ? ', and your hotel is paid' : ''}. Until ${esc(dayHm(k.activeTo, tz))}.</p>${big}`;
}

function flightPill(f) {
  if (f.status === 'CANCELLED') return '<span class="pill bad">Cancelled</span>';
  if (f.status === 'LANDED') return '<span class="pill plain">Landed</span>';
  if (f.status === 'DEPARTED') return '<span class="pill info">In the air</span>';
  if (/late/.test(f.statusText)) return `<span class="pill warn">${esc(f.statusText.replace('running ', ''))}</span>`;
  return '<span class="pill ok">On time</span>';
}
function renderFlight(s, tz) {
  const f = s.legs.find((l) => l.status !== 'LANDED') || s.legs.at(-1);
  $('tv-flight').innerHTML = `
    <div class="tv-card-head"><h2>${f.status === 'LANDED' ? 'Last flight' : 'Next flight'}</h2><span>${esc(f.id)}</span></div>
    <div class="tv-flight"><div class="ap">${esc(f.from)}<span>${esc(CITY[f.from] || f.from)}</span></div><div class="mid">→</div><div class="ap to">${esc(f.to)}<span>${esc(CITY[f.to] || f.to)}</span></div></div>
    <div class="tv-flight-foot"><span>Departs ${esc(dayHm(f.est_dep, tz))} local</span>${flightPill(f)}</div>`;
}

function renderHotel(s) {
  const rows = hotelRows(s).filter((l) => l.status !== 'CANCELLED');
  const card = $('tv-hotel');
  if (s.mode !== 'transfer' || !rows.length || s.summary) { card.hidden = true; return; }
  card.hidden = false;
  const name = rows[0].payeeName.replace(/\s+GmbH$/, '');
  card.innerHTML = `<div class="tv-card-head"><h2>Hotel</h2><span>${rows.length} night${rows.length === 1 ? '' : 's'}</span></div>
    <div class="tv-hotel"><b>${esc(name)}</b><p>Paid directly by ${esc(S.company.replace(/\s*\(.*\)/, ''))}. Just give your name at the desk; there is nothing to pay and nothing to claim.</p>
    <span class="pill ok tag">Room paid</span></div>`;
}

function renderMoney(s, tz) {
  const el = $('tv-money');
  if (s.mode !== 'transfer') {
    const c = s.card;
    el.innerHTML = c
      ? `<div class="tv-card-head"><h2>Your Detour card</h2><span>•••• ${esc(c.last4 || '')}</span></div>
        <div class="tv-row"><div class="l"><b>Left to spend</b><span>${esc(c.categoryLabels.join(', '))}</span></div><div class="r"><b>${money(c.remaining, c.controls.currency)}</b><span>of ${money(c.controls.limit, c.controls.currency)}</span></div></div>`
      : '<div class="tv-card-head"><h2>Money</h2><span>Nothing needed yet</span></div><div class="tv-row"><div class="l"><span>A card appears here the moment your trip is disrupted.</span></div></div>';
    return;
  }
  const rows = toTraveller(s);
  if (!rows.length) {
    el.innerHTML = '<div class="tv-card-head"><h2>Money sent to you</h2><span>Nothing needed yet</span></div><div class="tv-row"><div class="l"><span>If your trip is disrupted, Detour sends money straight to your bank account.</span></div></div>';
    return;
  }
  el.innerHTML = `<div class="tv-card-head"><h2>Money sent to you</h2><span>to your bank account</span></div>` + rows.slice().reverse().map((l) => {
    const off = l.status === 'CANCELLED';
    const when = l.status === 'SENT' ? `Sent ${dayHm(l.payAt, tz)}` : l.status === 'SCHEDULED' ? `Arrives ${dayHm(l.payAt, tz)}` : 'Not needed';
    const rec = l.received && l.received.currency !== l.currency ? money(l.received.amount, l.received.currency) : money(l.amount, l.currency);
    return `<div class="tv-row ${off ? 'off' : ''}"><div class="l"><b>${esc(l.what)}</b><span>${esc(when)}</span></div><div class="r"><b>${esc(rec)}</b><span>${money(l.amount, l.currency)}</span></div></div>`;
  }).join('');
}

function renderChat(s, tz) {
  const chat = $('tv-chat');
  const writing = s.activity && /^(Messaging|Replying|Reading .*message)/.test(s.activity);
  if (!s.messages.length && !writing) {
    chat.innerHTML = '<div class="chat-empty">Messages from Detour appear here. You can also ask for help, for example if the hotel asks for a deposit.</div>';
  } else {
    let lastDay = '';
    chat.innerHTML = s.messages.map((m) => {
      const day = fmt(m.at, tz, { weekday: 'long', day: 'numeric', month: 'long' });
      const sep = day !== lastDay ? `<div class="tv-day">${esc(day)}</div>` : '';
      lastDay = day;
      return `${sep}<div class="msg ${m.from}">${esc(m.text)}<time>${hm(m.at, tz)}</time></div>`;
    }).join('') + (writing ? '<div class="typing" aria-label="Detour is writing"><span></span><span></span><span></span></div>' : '');
  }
  const count = s.messages.length + (writing ? 1 : 0);
  if (count !== lastCount) chat.scrollTop = chat.scrollHeight;
  lastCount = count;
  const lock = s.busy || s.playing;
  $('tv-text').disabled = lock;
  $('tv-form').querySelector('button').disabled = lock;
  $('tv-text').placeholder = lock ? 'Detour is working…' : 'Message Detour';
}

function show(name) {
  screen = name;
  document.querySelectorAll('.tv-screen').forEach((el) => el.classList.toggle('active', el.dataset.screen === name));
  document.querySelectorAll('#tv-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.screen === name));
  if (S) render(S);
  if (name === 'messages') $('tv-chat').scrollTop = $('tv-chat').scrollHeight;
}
$('tv-tabs').onclick = (e) => { const b = e.target.closest('button[data-screen]'); if (b) show(b.dataset.screen); };

$('tv-form').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('tv-text').value.trim();
  if (!text || S?.busy || S?.playing) return;
  $('tv-text').value = '';
  try {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const j = await r.json();
    if (!j.ok) window.DetourToast(j.error || 'Message not sent.');
  } catch {
    window.DetourToast('Message not sent: no connection.');
  }
};

show(screen);
DetourDock.mount();
if (params.has('snapshot')) {
  fetch('/api/state').then((r) => r.json()).then(render);
} else {
  const events = new EventSource('/events');
  events.onmessage = (e) => render(JSON.parse(e.data));
  events.onerror = () => window.DetourToast('Reconnecting…');
}
