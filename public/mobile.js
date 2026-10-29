// Shared base for Detour's phone screens (launcher, traveller, manager):
// formatting, toasts, live updates and installing the app.
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
const company = (s) => s.company.replace(/\s*\(.*\)/, '');

let toastTimer;
window.DetourToast = (text) => {
  const t = $('toast');
  if (!t) return;
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
};

async function api(path, body) {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const j = await r.json();
    if (!j.ok) window.DetourToast(j.error || 'Something went wrong.');
    return j;
  } catch {
    window.DetourToast('No connection to Detour.');
    return { ok: false };
  }
}

// Live state: Server-Sent Events, or a single load with ?snapshot (for screenshots).
function connect(render) {
  if (params.has('snapshot')) {
    fetch('/api/state').then((r) => r.json()).then(render);
    return;
  }
  const events = new EventSource('/events');
  events.onmessage = (e) => render(JSON.parse(e.data));
  events.onerror = () => window.DetourToast('Reconnecting…');
}

// Bottom tab bar: buttons and screens share data-screen names.
function setupTabs(initial, onChange) {
  const show = (name) => {
    document.querySelectorAll('.tv-screen').forEach((el) => el.classList.toggle('active', el.dataset.screen === name));
    document.querySelectorAll('.tv-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.screen === name));
    onChange?.(name);
  };
  document.querySelector('.tv-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-screen]');
    if (b) show(b.dataset.screen);
  });
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) show(go.dataset.goto);
  });
  show(initial);
  return show;
}

// Installable app: register the service worker (not inside the demo frames).
if ('serviceWorker' in navigator && !params.has('embed') && !params.has('snapshot')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
