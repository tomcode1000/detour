// Shared base for the Detour phone app (traveller and travel manager): helpers, icons, live state,
// views and tabs, toasts and the route map.
const $ = (id) => document.getElementById(id);
// Live updates re-render screens many times a second while Detour is busy. Rebuilding a screen
// whose HTML has not changed would replace its buttons between finger-down and finger-up and
// lose the tap (an Approve tap was lost this way, 8 Nov 2026), so an unchanged screen is kept.
(() => {
  const d = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', {
    configurable: true,
    get() { return d.get.call(this); },
    set(v) {
      if (this.__html === v && d.get.call(this) === this.__ser) return;
      d.set.call(this, v);
      this.__html = v;
      this.__ser = d.get.call(this);
    },
  });
})();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);
const EMBED = params.has('embed');
if (EMBED) document.body.classList.add('embed');

// ---------------------------------------------------------------- formatting
const moneyFmt = new Map();
function money(n, cur, opts = {}) {
  if (n == null || !cur) return '—';
  const key = cur + JSON.stringify(opts);
  if (!moneyFmt.has(key)) moneyFmt.set(key, new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, ...opts }));
  return moneyFmt.get(key).format(n);
}
const fmt = (ms, tz, opts) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', ...opts }).format(new Date(ms));
const hm = (ms, tz) => fmt(ms, tz, { hour: '2-digit', minute: '2-digit' });
const dayHm = (ms, tz) => fmt(ms, tz, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const dateHm = (ms, tz) => fmt(ms, tz, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayDate = (ms, tz) => fmt(ms, tz, { weekday: 'short', day: 'numeric', month: 'short' });
const sum = (rows, f = (l) => l.amount) => rows.reduce((a, l) => a + f(l), 0);
const initials = (name) => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
const companyName = (s) => (s.account?.company.name || s.company || '').replace(/\s*\(.*\)/, '');
const ago = (from, to) => {
  const m = Math.max(0, Math.round((to - from) / 60000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

const AIRPORTS = {
  SIN: ['Singapore', 1.364, 103.991, 'Asia/Singapore'], FRA: ['Frankfurt', 50.038, 8.562, 'Europe/Berlin'], LHR: ['London', 51.47, -0.454, 'Europe/London'],
  LGW: ['London', 51.153, -0.182, 'Europe/London'], CDG: ['Paris', 49.01, 2.548, 'Europe/Paris'], AMS: ['Amsterdam', 52.31, 4.768, 'Europe/Amsterdam'],
  MUC: ['Munich', 48.354, 11.786, 'Europe/Berlin'], ZRH: ['Zurich', 47.465, 8.549, 'Europe/Zurich'], MAD: ['Madrid', 40.472, -3.561, 'Europe/Madrid'],
  LIS: ['Lisbon', 38.774, -9.134, 'Europe/Lisbon'], IST: ['Istanbul', 41.262, 28.742, 'Europe/Istanbul'], DXB: ['Dubai', 25.253, 55.365, 'Asia/Dubai'],
  DOH: ['Doha', 25.273, 51.608, 'Asia/Qatar'], HKG: ['Hong Kong', 22.308, 113.918, 'Asia/Hong_Kong'], NRT: ['Tokyo', 35.772, 140.393, 'Asia/Tokyo'],
  HND: ['Tokyo', 35.549, 139.78, 'Asia/Tokyo'], ICN: ['Seoul', 37.46, 126.441, 'Asia/Seoul'], BKK: ['Bangkok', 13.69, 100.75, 'Asia/Bangkok'],
  KUL: ['Kuala Lumpur', 2.746, 101.71, 'Asia/Kuala_Lumpur'], SYD: ['Sydney', -33.94, 151.175, 'Australia/Sydney'], JFK: ['New York', 40.641, -73.778, 'America/New_York'],
  EWR: ['Newark', 40.69, -74.174, 'America/New_York'], BOS: ['Boston', 42.366, -71.01, 'America/New_York'], ORD: ['Chicago', 41.974, -87.907, 'America/Chicago'],
  SFO: ['San Francisco', 37.621, -122.379, 'America/Los_Angeles'], LAX: ['Los Angeles', 33.942, -118.408, 'America/Los_Angeles'], YYZ: ['Toronto', 43.678, -79.625, 'America/Toronto'],
  LOS: ['Lagos', 6.577, 3.321, 'Africa/Lagos'], NBO: ['Nairobi', -1.319, 36.928, 'Africa/Nairobi'], JNB: ['Johannesburg', -26.139, 28.246, 'Africa/Johannesburg'],
};
const city = (code) => AIRPORTS[code]?.[0] || code;

// ---------------------------------------------------------------- icons
const ICONS = {
  plane: 'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  more: 'M3.6 12a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 1 0-2.8 0M10.6 12a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 1 0-2.8 0M17.6 12a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 1 0-2.8 0',
  approvals: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 12l2.5 2.5 4.5-5',
  'chev-r': 'm9 6 6 6-6 6', 'chev-l': 'm15 6-6 6 6 6', 'chev-d': 'm6 9 6 6 6-6',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  shield: 'M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6zM9 12l2 2 4-4',
  'shield-o': 'M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6z',
  warn: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  bang: 'M12 7v6M12 17h.01',
  wallet: 'M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2M3 6v13a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4',
  bed: 'M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9',
  meal: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7',
  car: 'M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18.4 10 16 6H8l-2.4 4-2.1 1.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2M7 17h10M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  clip: 'm21.4 11-8.9 8.9a5.5 5.5 0 0 1-7.8-7.8l8.9-8.9a3.7 3.7 0 0 1 5.2 5.2l-8.9 8.9a1.8 1.8 0 0 1-2.6-2.6l8.2-8.2',
  send: 'm22 2-7 20-4-9-9-4zM22 2 11 13',
  image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM21 15l-5-5L5 21',
  paste: 'M9 3h6v3H9zM16 4.5h2a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  x: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  'check-c': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 12l2.5 2.5 4.5-5',
  'x-c': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15 9l-6 6M9 9l6 6',
  building: 'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18zM6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  bank: 'M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3',
  plus: 'M12 5v14M5 12h14',
  copy: 'M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  refresh: 'M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  card: 'M2 5h20v14H2zM2 10h20M6 15h4',
  user: 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  'user-plus': 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6',
  briefcase: 'M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16v-4M12 8h.01',
  swap: 'M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16',
  currency: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z',
  percent: 'M19 5 5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
};
document.body.insertAdjacentHTML('afterbegin', `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <symbol id="logo" viewBox="0 0 32 35"><path fill="#fff" d="M0 2.5A2.5 2.5 0 0 1 2.5 0H15c9.4 0 17 7.8 17 17.5S24.4 35 15 35H2.5A2.5 2.5 0 0 1 0 32.5z"/><path fill="#04111b" d="M7.2 8.4 25 17.5 7.2 26.6l4.3-9.1z"/></symbol>
  ${Object.entries(ICONS).map(([k, d]) => `<symbol id="i-${k}" viewBox="0 0 24 24"><path d="${d}"/></symbol>`).join('')}
</defs></svg>`);
const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const LOGO = '<svg aria-hidden="true"><use href="#logo"/></svg>';
document.querySelectorAll('[data-icon]').forEach((el) => { el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)); });
document.querySelectorAll('[data-logo]').forEach((el) => { el.insertAdjacentHTML('afterbegin', LOGO); });

// ---------------------------------------------------------------- toast and API
let toastTimer;
// ---------------------------------------------------------------- airline claim (both apps)
// The row that opens the claim, and the claim page itself: what is owed, to whom, and the letter.
function claimRow(c) {
  if (!c?.eligible) return '';
  const parts = [];
  if (c.compensation.amount) parts.push(`${money(c.compensation.amount, c.compensation.currency, { maximumFractionDigits: 0 })} ${c.compensation.passOn ? 'compensation, passed on' : `for ${c.compensation.owedTo.split(' ')[0]}`}`);
  if (c.care.total) parts.push(`${money(c.care.total, c.care.currency, { maximumFractionDigits: 0 })} back to ${c.care.owedTo.replace(/\s*\(.*\)$/, '')}`);
  return `<div class="section-head"><h2>Airline claim</h2></div><div class="card"><button class="row tap" data-go="claim"><span class="ic green">${icon('doc')}</span><div class="grow"><b>Claim from ${esc(c.airline)}</b><small>${esc(parts.join(' · '))}</small></div>${claimPill(c)}${icon('chev-r', 'chev')}</button></div>`;
}
const CLAIM_PILL = { READY: ['info', 'Ready to send'], SENT: ['warn', 'Sent'], SETTLED: ['ok', 'Settled'] };
const claimPill = (c) => { const [cls, text] = CLAIM_PILL[c.status] || CLAIM_PILL.READY; return `<span class="pill ${cls}">${text}</span>`; };

// manage: the travel manager can move the claim along (sent to the airline, then settled).
function renderClaim(c, { manage = false } = {}) {
  const el = $('claim-body');
  if (!c?.eligible) { el.innerHTML = '<div class="empty">No claim yet. Detour prepares one when a disrupted trip ends.</div>'; return; }
  const company = c.care.owedTo.replace(/\s*\(.*\)$/, '');
  const rows = [];
  if (c.compensation.amount) rows.push(`<div class="row"><span class="ic green">${icon('wallet')}</span><div class="grow"><b>Compensation</b><small>For ${esc(c.compensation.owedTo)} · ${esc(c.compensation.why)}</small><small>${c.compensation.passOn ? `Paid to ${esc(c.compensation.owedTo.split(' ')[0])}; ${esc(company)}'s policy asks for it to be passed on` : `${esc(c.compensation.owedTo.split(' ')[0])}'s to keep: it is the passenger's by law`}</small></div><div class="end"><b>${money(c.compensation.amount, c.compensation.currency)}</b></div></div>`);
  if (c.care.total) rows.push(`<div class="row"><span class="ic purple">${icon('bed')}</span><div class="grow"><b>Meals, taxis and hotel</b><small>Back to ${esc(company)} · paid while stranded</small></div><div class="end"><b>${money(c.care.total, c.care.currency)}</b></div></div>`);
  el.innerHTML = `
    <div class="page-head"><h1 class="title">Claim from ${esc(c.airline)}</h1><p class="sub">${esc(c.from)} → ${esc(c.to)} arrived ${esc(c.delayText)} late. Written under ${esc(c.scheme)}.</p></div>
    <div class="card">${rows.join('')}<div class="row"><span class="ic plain">${icon('clock')}</span><div class="grow"><b>Status</b><small>${c.status === 'SETTLED' ? `Settled ${esc(dateHm(c.settledAt, Intl.DateTimeFormat().resolvedOptions().timeZone))}` : c.status === 'SENT' ? `Sent ${esc(dateHm(c.sentAt, Intl.DateTimeFormat().resolvedOptions().timeZone))} · airlines usually reply within a few weeks` : 'Written, not sent yet'}</small></div>${claimPill(c)}</div></div>
    ${manage && c.status !== 'SETTLED' ? `<button class="btn ghost block" id="claim-next">${icon('check')}${c.status === 'SENT' ? 'Mark as settled' : 'Mark as sent to the airline'}</button>` : ''}
    <div class="section-head"><h2>Letter to the airline</h2></div>
    <div class="card pad"><pre class="letter">${esc(c.letter)}</pre></div>
    ${c.caveats.map((t, i) => `<div class="note">${icon(i ? 'shield-o' : 'warn')}<span>${esc(t)}</span></div>`).join('')}
    <div class="btn-row"><button class="btn ghost" id="claim-copy">${icon('doc')}Copy letter</button><a class="btn primary" id="claim-mail">${icon('mail')}Email airline</a></div>`;
  const [subject, , ...body] = c.letter.split('\n').slice(1);
  $('claim-mail').href = `mailto:${encodeURIComponent(c.claimsEmail || '')}?subject=${encodeURIComponent(subject.replace(/^Subject: /, ''))}&body=${encodeURIComponent(body.join('\n'))}`;
  if ($('claim-next')) {
    $('claim-next').onclick = async () => {
      const j = await api('/api/claim', { status: c.status === 'SENT' ? 'SETTLED' : 'SENT' });
      if (j.ok) toast(c.status === 'SENT' ? 'Claim marked as settled.' : 'Claim marked as sent.');
    };
  }
  $('claim-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(c.letter); toast('Letter copied.'); } catch { toast('Select the letter to copy it.'); }
  };
}

// A Detour card, drawn as a card. `tag` says what it pays for; `figure` is the amount shown.
function cardArt(c, { currency, holder, tag = 'Hotels only', figure = ['Up to', c.limit] }) {
  const open = c.status === 'ACTIVE';
  return `<div class="vcard ${open ? '' : 'closed'}" aria-label="Detour card ending ${esc(c.last4 || '')}">
    <div class="vcard-top"><span class="vcard-brand"><svg class="vcard-logo" viewBox="0 0 32 35"><use href="#logo"/></svg>Detour</span><span class="vcard-tag">${open ? esc(tag) : 'Closed'}</span></div>
    <div class="vcard-chip"></div>
    <div class="vcard-num">•••• •••• •••• ${esc(c.last4 || '----')}</div>
    <div class="vcard-foot"><div><small>Card holder</small><b>${esc(holder)}</b></div><div><small>${esc(figure[0])}</small><b>${money(figure[1], currency)}</b></div><div class="vcard-net">Airwallex</div></div>
  </div>`;
}
const hotelCardArt = (c, o) => cardArt(c, o);
// The meals and taxis card: shows what is left to spend.
const mealCardArt = (card, holder) => cardArt({ status: card.status, last4: card.last4, limit: card.controls.limit }, { currency: card.controls.currency, holder, tag: 'Meals & taxis', figure: ['Left to spend', Math.max(0, card.remaining)] });

function toast(text) {
  const t = $('toast');
  if (!t) return;
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
}
window.DetourToast = toast;

async function api(path, body, { quiet = false } = {}) {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const j = await r.json();
    if (!j.ok && !quiet) toast(j.error || 'Something went wrong.');
    return j;
  } catch {
    if (!quiet) toast('No connection to Detour.');
    return { ok: false, error: 'No connection to Detour.' };
  }
}

// Live state: Server-Sent Events, or one load with ?snapshot (for screenshots).
function connect(render) {
  if (params.has('snapshot')) {
    fetch('/api/state').then((r) => r.json()).then(render);
    return;
  }
  const events = new EventSource('/events');
  events.onmessage = (e) => render(JSON.parse(e.data));
  events.onerror = () => toast('Reconnecting…');
}

// ---------------------------------------------------------------- views
// <section class="view" data-view="name" data-tab="tab"> ; buttons with data-go="name" open a view,
// data-back goes to the previous one. Tabs are buttons in .tabs with data-go.
const history_ = [];
let currentView = null;
const viewHooks = {};
function go(name, { replace = false, back = false } = {}) {
  const el = document.querySelector(`.view[data-view="${name}"]`);
  if (!el) return;
  if (!back && !replace && currentView && currentView !== name) history_.push(currentView);
  currentView = name;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v === el));
  const tab = el.dataset.tab || name;
  document.querySelectorAll('.tabs [data-go]').forEach((b) => b.classList.toggle('active', b.dataset.go === tab));
  const app = document.querySelector('.app');
  app.classList.toggle('no-tabs', el.hasAttribute('data-no-tabs'));
  const backBtn = $('back');
  if (backBtn) backBtn.hidden = !el.hasAttribute('data-sub');
  el.scrollTop = 0;
  viewHooks[name]?.();
}
function goBack() {
  const prev = history_.pop();
  if (prev) go(prev, { back: true });
}
function onView(name, fn) { viewHooks[name] = fn; }
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (g) {
    e.preventDefault();
    if (g.closest('.tabs')) history_.length = 0;
    go(g.dataset.go, { replace: Boolean(g.closest('.tabs')) });
  }
  if (e.target.closest('[data-back]')) goBack();
});

// ---------------------------------------------------------------- moments
// One at a time, queued: { tone: ok|warn|bad|info, icon, title, sub, amount, amountNote, rows: [[icon, label, value]],
// ref, progress, primary: { label, go?, run? }, secondary: { label, go?, run? } }
const momentQueue = [];
let momentOpen = false;
// ---------------------------------------------------------------- phone notifications
// While the app is in the background, each moment is also shown as a phone notification.
const canNotify = () => 'Notification' in window && 'serviceWorker' in navigator && !EMBED;
function notifyPhone(title, body) {
  if (!canNotify() || Notification.permission !== 'granted' || !document.hidden) return;
  navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/favicon-32.png', tag: title })).catch(() => {});
}
function notifRow() {
  if (!canNotify()) return '';
  const p = Notification.permission;
  const sub = p === 'granted' ? 'On · you are told even when Detour is closed' : p === 'denied' ? 'Blocked · allow them in your browser settings' : 'Get told the moment something happens';
  return `<button class="row tap" data-notif ${p !== 'default' ? 'disabled' : ''}><span class="ic">${icon('bell')}</span><div class="grow"><b>Notifications</b><small>${sub}</small></div>${p === 'granted' ? '<span class="pill ok">On</span>' : p === 'denied' ? '<span class="pill plain">Off</span>' : '<span class="pill info">Turn on</span>'}</button>`;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-notif]');
  if (!b || !canNotify()) return;
  const p = await Notification.requestPermission();
  toast(p === 'granted' ? 'Notifications are on.' : 'Notifications are off.');
  document.querySelectorAll('[data-notif]').forEach((el) => { el.outerHTML = notifRow(); });
});

function moment(m) {
  if (params.has('snapshot')) return;
  notifyPhone(m.title, m.sub || '');
  momentQueue.push(m);
  if (!momentOpen) nextMoment();
}
function nextMoment() {
  const m = momentQueue.shift();
  if (!m) { momentOpen = false; return; }
  momentOpen = true;
  const app = document.querySelector('.app');
  const el = document.createElement('div');
  el.className = 'moment-scrim';
  const btn = (b, cls) => (b ? `<button class="btn ${cls} block" data-m="${cls}">${esc(b.label)}${cls === 'primary' ? icon('arrow') : ''}</button>` : '');
  el.innerHTML = `<section class="moment" role="dialog" aria-live="assertive" aria-label="${esc(m.title)}">
    <div class="grab"></div>
    <div class="moment-mark ${m.tone || 'ok'}">${icon(m.icon || 'check')}</div>
    <h2>${esc(m.title)}</h2>
    ${m.sub ? `<p class="sub">${esc(m.sub)}</p>` : ''}
    ${m.amount ? `<div class="amount">${esc(m.amount)}${m.amountNote ? `<small>${esc(m.amountNote)}</small>` : ''}</div>` : ''}
    ${m.progress ? '<div class="moment-progress"><i></i></div>' : ''}
    ${m.rows?.length ? `<div class="card">${m.rows.map(([ic, label, value, cls]) => `<div class="row" style="min-height:54px"><span class="ic ${cls || ''}" style="width:36px;height:36px">${icon(ic)}</span><div class="grow"><b style="font-size:14.5px;font-weight:500">${esc(label)}</b></div>${value ? `<b>${esc(value)}</b>` : ''}</div>`).join('')}</div>` : ''}
    ${m.ref ? `<p class="ref">${esc(m.ref)}</p>` : ''}
    ${btn(m.primary || { label: 'Done' }, 'primary')}${btn(m.secondary, 'quiet')}
  </section>`;
  const close = (b) => {
    el.remove();
    if (b?.go) go(b.go, { replace: true });
    b?.run?.();
    nextMoment();
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (b) close(b.dataset.m === 'primary' ? (m.primary || {}) : m.secondary);
    else if (e.target === el) close(null);
  });
  app.appendChild(el);
}

// ---------------------------------------------------------------- route map (Leaflet, loaded when first needed)
let leafletReady = null;
function loadLeaflet() {
  if (leafletReady) return leafletReady;
  leafletReady = new Promise((ok, fail) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    js.onload = () => ok(window.L);
    js.onerror = fail;
    document.head.appendChild(js);
  });
  return leafletReady;
}

// A gentle arc between two airports: a quadratic curve in lat/lng, bowed towards the pole.
function arc(a, b) {
  const [la1, lo1] = a; const [la2, lo2] = b;
  const dx = la2 - la1; const dy = lo2 - lo1;
  const len = Math.hypot(dx, dy) || 1;
  let px = -dy / len; let py = dx / len;
  if (px < 0) { px = -px; py = -py; }
  const cx = (la1 + la2) / 2 + px * len * 0.18;
  const cy = (lo1 + lo2) / 2 + py * len * 0.18;
  const pts = [];
  for (let t = 0; t <= 1.0001; t += 1 / 48) {
    const u = 1 - t;
    pts.push([u * u * la1 + 2 * u * t * cx + t * t * la2, u * u * lo1 + 2 * u * t * cy + t * t * lo2]);
  }
  return pts;
}

// legs: [{ from, to, state: 'done' | 'next' | 'broken' | 'new' }], stay: airport code where the traveller is stranded
const maps = new WeakMap();
async function drawRoute(el, legs, { stay = null } = {}) {
  let L;
  try { L = await loadLeaflet(); } catch { el.innerHTML = '<div class="empty">The map could not load. Your trip details are below.</div>'; return; }
  let m = maps.get(el);
  if (!m) {
    const map = L.map(el, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, worldCopyJump: false });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 10, attribution: 'Tiles © Esri',
    }).addTo(map);
    m = { map, layer: L.layerGroup().addTo(map), key: '' };
    maps.set(el, m);
  }
  const key = JSON.stringify([legs, stay]);
  if (key === m.key) { m.map.invalidateSize(); return; }
  m.key = key;
  m.layer.clearLayers();
  const pts = [];
  const STYLE = {
    done: { color: '#a9bfd6', weight: 2, opacity: 0.45 },
    next: { color: '#a9bfd6', weight: 2.5, opacity: 0.95 },
    broken: { color: '#ff6b6b', weight: 2.5, opacity: 0.9, dashArray: '6 7' },
    new: { color: '#45d28e', weight: 2.5, opacity: 0.95 },
  };
  const codes = new Set();
  for (const leg of legs) {
    const a = AIRPORTS[leg.from]; const b = AIRPORTS[leg.to];
    if (!a || !b) continue;
    const line = arc([a[1], a[2]], [b[1], b[2]]);
    L.polyline(line, STYLE[leg.state] || STYLE.next).addTo(m.layer);
    pts.push(...line);
    codes.add(leg.from); codes.add(leg.to);
  }
  for (const code of codes) {
    const a = AIRPORTS[code];
    // When two airports are close (London and Frankfurt), the western label sits to the left of its dot.
    const crowded = [...codes].some((o) => o !== code && Math.abs(AIRPORTS[o][1] - a[1]) < 6 && Math.abs(AIRPORTS[o][2] - a[2]) < 12 && AIRPORTS[o][2] > a[2]);
    L.marker([a[1], a[2]], { icon: L.divIcon({ className: '', html: `<div class="ap-pin ${code === stay ? 'stay' : ''} ${crowded ? 'w' : ''}"><b>${code}</b><i></i></div>`, iconSize: [0, 0] }) }).addTo(m.layer);
  }
  if (pts.length) m.map.fitBounds(L.latLngBounds(pts), { padding: [34, 34], maxZoom: 5 });
  else m.map.setView([30, 20], 1);
  setTimeout(() => m.map.invalidateSize(), 60);
}

// Installable app: register the service worker (not inside the demo frames).
if ('serviceWorker' in navigator && !EMBED && !params.has('snapshot')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
