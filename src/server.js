// Detour demo server: one page, live updates over Server-Sent Events, no dependencies.
// Run: npm start   then open http://localhost:4100
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, loadEnv } from './env.js';
import { Engine } from './engine.js';
import { createFunding } from './funding/index.js';
import { createAgent } from './agent/index.js';
import { Accounts } from './accounts.js';
import { createMailer } from './notify/mailer.js';
import { createEmails } from './notify/emails.js';
import { createFlightStatus, localDate } from './flights/aerodatabox.js';

const env = loadEnv();
const load = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const policy = load('config/policy.json');
const scenario = load(`scenarios/${env.SCENARIO || 'ada-frankfurt'}.json`);

const engine = new Engine({
  scenario,
  policy,
  makeFunding: ({ clock, runKey }) => createFunding({ env, clock, runKey, scenario, policy }),
  agent: createAgent({ env }),
});

const accounts = new Accounts({ policy, scenario });
const flightStatus = createFlightStatus(env, { delayThresholdH: policy.rules.delay_threshold_hours });
const state = () => ({ ...engine.snapshot(), account: accounts.view(), flightFeed: flightStatus ? flightStatus.name : null });

// Links in emails point at the address people use to reach this server (PUBLIC_URL wins).
let origin = env.PUBLIC_URL || `http://localhost:${env.PORT || 4100}`;
const mailer = createMailer(env);
const emails = createEmails({ mailer, env, engine, accounts, baseUrl: () => env.PUBLIC_URL || origin });

const clients = new Set();
let last = null;
const broadcast = () => {
  // A copy, not the live state: the engine's lists change in place, so comparing with the
  // live object would never show what is new.
  const json = JSON.stringify(state());
  const now = JSON.parse(json);
  emails.onChange(last, now);
  last = now;
  const data = `data: ${json}\n\n`;
  for (const res of clients) res.write(data);
};
engine.onChange(broadcast);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json',
};

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

// Trips the travel manager adds (not Ada's scripted demo trip) are checked against the real flight
// status service, when it is turned on: the flight must exist that day and leave from that airport.
// If the service itself can't be reached, the trip is still added and the check is tried again later.
async function checkRealFlights(inv) {
  if (!flightStatus || inv.live) return;
  for (const f of inv.flights) {
    let s;
    try { s = await flightStatus.lookup(f.id, Date.parse(f.dep), f.from); } catch { continue; }
    const day = localDate(Date.parse(f.dep), f.from);
    if (!s) throw new Error(`${f.id} doesn't fly on ${day}, according to the flight status service. Check the flight number and date.`);
    if (s.wrongRoute) throw new Error(`${f.id} on ${day} flies ${s.from} → ${s.to}, not from ${f.from}. Check the flight.`);
    f.live = s;
  }
}

// Follow real trips' flights from a day before departure until they land.
async function watchRealFlights() {
  if (!flightStatus) return;
  let changed = false;
  for (const inv of accounts.invites) {
    if (inv.live) continue;
    for (const f of inv.flights) {
      const dep = Date.parse(f.dep);
      const end = (f.arr ? Date.parse(f.arr) : dep + 18 * 3600e3) + 6 * 3600e3;
      if (Date.now() < dep - 24 * 3600e3 || Date.now() > end || f.live?.status === 'LANDED') continue;
      try {
        const s = await flightStatus.lookup(f.id, dep, f.from);
        if (!s || s.wrongRoute) continue;
        if (JSON.stringify({ ...s, checkedAt: 0 }) !== JSON.stringify({ ...f.live, checkedAt: 0 })) changed = true;
        if (s.disrupted && !f.live?.disrupted) console.log(`Real flight disrupted: ${f.id} ${s.status}`);
        f.live = s;
      } catch (e) { console.log(`Flight status: ${e.message}`); }
    }
  }
  if (changed) broadcast();
}
setInterval(watchRealFlights, 10 * 60e3).unref();

// The story starts once the travel manager has added Ada's trip and she has finished registering.
const needsTraveller = () => {
  if (!accounts.liveReady()) throw new Error("Set up Ada first: add her trip on Sam's phone, then finish registering on Ada's phone.");
};

const actions = {
  'POST /api/step': () => { needsTraveller(); return engine.step(); },
  'POST /api/run': () => { needsTraveller(); return engine.runToPause(); },
  'POST /api/reset': () => { accounts.reset(); return engine.reset(); },
  'POST /api/chat': (b) => (b.text ? engine.chat(String(b.text).slice(0, 500)) : null),
  'POST /api/decide': (b) => engine.decide(b.id, b.decision === 'approve' ? 'approve' : 'decline'),
  'POST /api/purchase': (b) => engine.tryPurchase(b),
  // Accounts: the travel manager signs up and invites travellers; travellers finish registering.
  'POST /api/signup': (b) => { const r = accounts.signup(b); broadcast(); return r; },
  'POST /api/signin': (b) => accounts.signin(b),
  'POST /api/policy': (b) => { const r = accounts.updatePolicy(b); broadcast(); return r; },
  'POST /api/invite': async (b) => {
    const r = accounts.invite(b);
    try { await checkRealFlights(r); } catch (e) { accounts.remove({ token: r.token }); throw e; }
    broadcast(); emails.invite(r).then(broadcast); return r;
  },
  'POST /api/invite/renew': (b) => { const r = accounts.renew(b); broadcast(); emails.invite(r).then(broadcast); return r; },
  'POST /api/invite/remove': (b) => {
    const inv = accounts.invites.find((i) => i.token === b.token);
    if (inv?.live && engine.cursor > 0) throw new Error("Ada's trip is running in the demo. Use Reset on the demo page to start again.");
    const r = accounts.remove(b); broadcast(); return r;
  },
  'POST /api/claim': (b) => engine.setClaimStatus(String(b.status || '')),
  'POST /api/traveller/find': (b) => accounts.find(b),
  'POST /api/traveller/dispute': (b) => { const r = accounts.dispute(b); broadcast(); return r; },
  'POST /api/traveller/register': (b) => { const r = accounts.register(b); broadcast(); return r; },
  'POST /api/airline-message': (b) => (b.text || b.inboxId ? engine.shareAirlineMessage({
    text: b.inboxId ? (() => { const m = engine.inbox.find((x) => x.id === b.inboxId); return m ? `${m.subject}\n\n${m.body}` : ''; })() : String(b.text),
    how: ['pasted', 'screenshot', 'forwarded', 'shared'].includes(b.how) ? b.how : 'pasted',
    inboxId: b.inboxId || null,
  }) : null),
};

// The demo is one shared story. If the last visitor left it part-way or finished and nobody has
// touched it for a while, put it back to the start so the next visitor begins at the beginning.
const IDLE_RESET_MS = Number(env.IDLE_RESET_MINUTES || 20) * 60e3;
let lastTouch = Date.now();
let dirty = false;
setInterval(() => {
  if (!dirty || engine.busy || engine.playing || Date.now() - lastTouch < IDLE_RESET_MS) return;
  dirty = false;
  accounts.reset();
  engine.reset();
  console.log('Demo reset after being left idle');
}, 60e3).unref();

let balanceCache = null;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.headers.host && !/^localhost|^127\./.test(req.headers.host)) origin = `http://${req.headers.host}`;

  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(state())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/state') return send(res, 200, state());
  if (url.pathname === '/api/balance') {
    // The company's Airwallex balances, read live (kept for 20 s so screens can ask freely).
    try {
      if (!balanceCache || Date.now() - balanceCache.at > 20e3) balanceCache = { at: Date.now(), items: engine.funding.balances ? await engine.funding.balances() : null };
      return send(res, 200, { ok: true, result: balanceCache.items });
    } catch (e) {
      return send(res, 500, { ok: false, error: e.message });
    }
  }

  const action = actions[`${req.method} ${url.pathname}`];
  if (action) {
    lastTouch = Date.now();
    dirty = url.pathname !== '/api/reset';
    try {
      const result = await action(await readBody(req));
      return send(res, 200, { ok: true, result: result ?? null });
    } catch (e) {
      return send(res, 500, { ok: false, error: e.message });
    }
  }

  // Website pages (landing, download, demo) and the installable phone app (launcher, traveller, manager).
  const PAGES = {
    '/': 'index.html', '/download': 'download.html', '/demo': 'demo.html', '/security': 'security.html',
    '/app': 'app.html', '/traveller': 'traveller.html', '/manager': 'manager.html',
  };
  const file = path.join(ROOT, 'public', PAGES[url.pathname.replace(/\/$/, '') || '/'] || url.pathname);
  if (!file.startsWith(path.join(ROOT, 'public')) || !existsSync(file)) return send(res, 404, { error: 'not found' });
  const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' };
  if (url.pathname === '/sw.js') headers['Cache-Control'] = 'no-cache';
  res.writeHead(200, headers);
  res.end(readFileSync(file));
});

const port = Number(env.PORT || 4100);
server.listen(port, () => {
  const snap = engine.snapshot();
  console.log(`Detour running at http://localhost:${port}`);
  console.log(`Funding: ${snap.adapters.funding}   Agent: ${snap.adapters.agent}   Email: ${mailer ? `UnitPost (${mailer.from})` : 'off'}`);
  console.log(`Real flight status: ${flightStatus ? flightStatus.name : 'off (set AERODATABOX_KEY)'}`);
});
