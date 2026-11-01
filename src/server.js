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
const state = () => ({ ...engine.snapshot(), account: accounts.view() });

const clients = new Set();
const broadcast = () => {
  const data = `data: ${JSON.stringify(state())}\n\n`;
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

const actions = {
  'POST /api/step': () => engine.step(),
  'POST /api/run': () => engine.runToPause(),
  'POST /api/reset': () => { accounts.reset(); return engine.reset(); },
  'POST /api/chat': (b) => (b.text ? engine.chat(String(b.text).slice(0, 500)) : null),
  'POST /api/decide': (b) => engine.decide(b.id, b.decision === 'approve' ? 'approve' : 'decline'),
  'POST /api/purchase': (b) => engine.tryPurchase(b),
  // Accounts: the travel manager signs up and invites travellers; travellers finish registering.
  'POST /api/signup': (b) => { const r = accounts.signup(b); broadcast(); return r; },
  'POST /api/signin': (b) => accounts.signin(b),
  'POST /api/policy': (b) => { const r = accounts.updatePolicy(b); broadcast(); return r; },
  'POST /api/invite': (b) => { const r = accounts.invite(b); broadcast(); return r; },
  'POST /api/traveller/find': (b) => accounts.find(b),
  'POST /api/traveller/register': (b) => { const r = accounts.register(b); broadcast(); return r; },
  'POST /api/airline-message': (b) => (b.text || b.inboxId ? engine.shareAirlineMessage({
    text: b.inboxId ? (() => { const m = engine.inbox.find((x) => x.id === b.inboxId); return m ? `${m.subject}\n\n${m.body}` : ''; })() : String(b.text),
    how: ['pasted', 'screenshot', 'forwarded', 'shared'].includes(b.how) ? b.how : 'pasted',
    inboxId: b.inboxId || null,
  }) : null),
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(state())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/state') return send(res, 200, state());

  const action = actions[`${req.method} ${url.pathname}`];
  if (action) {
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
  console.log(`Funding: ${snap.adapters.funding}   Agent: ${snap.adapters.agent}`);
});
