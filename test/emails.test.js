import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEmails } from '../src/notify/emails.js';
import { Accounts } from '../src/accounts.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const setup = (env) => {
  const policy = load('config/policy.json');
  const scenario = load('scenarios/ada-frankfurt.json');
  const accounts = new Accounts({ policy, scenario });
  const sent = [];
  const log = [];
  const mailer = { send: async (m) => { sent.push(m); return { id: `em_${sent.length}` }; } };
  const engine = { runKey: 'run-1', record: (src, text) => log.push(text) };
  const emails = createEmails({ mailer, env, engine, accounts, baseUrl: () => 'https://detour.example.org' });
  return { accounts, emails, sent, log };
};
const dep = new Date(Date.now() + 7 * 864e5).toISOString();

test('a real address gets the invite with the link; a fictional one is skipped without a demo inbox', async () => {
  const { accounts, emails, sent, log } = setup({});
  const lena = accounts.invite({ name: 'Lena Hart', email: 'lena@gmail.com', flights: [{ id: 'LH403', from: 'FRA', to: 'JFK', dep }] });
  await emails.invite(lena);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'lena@gmail.com');
  assert.ok(sent[0].html.includes(`https://detour.example.org/traveller?invite=${lena.token}`), 'the invite link is in the email');
  assert.equal(sent[0].key, `invite-${lena.token}`);
  const ada = accounts.invite({ name: 'Ada Lim', email: 'ada.lim@northwind.example', flights: [{ id: 'LH403', from: 'FRA', to: 'JFK', dep }] });
  await emails.invite(ada);
  assert.equal(sent.length, 1, 'nothing sent to a .example address');
  assert.match(log.at(-1), /fictional address/);
});

test('with DEMO_INBOX, fictional addresses go to the demo inbox, and trip moments are emailed once', async () => {
  const { accounts, emails, sent } = setup({ DEMO_INBOX: 'me@mydomain.com' });
  const ada = accounts.invite({ name: 'Ada Lim', email: 'ada.lim@northwind.example', flights: [{ id: 'LH403', from: 'FRA', to: 'JFK', dep }] });
  await emails.invite(ada);
  assert.equal(sent.at(-1).to, 'me@mydomain.com');
  const policy = load('config/policy.json');
  const before = { card: null, payments: [], approvals: [], summary: null };
  const after = { mode: 'card', policy, card: { last4: '7710', controls: { city: 'Frankfurt', limit: 120, currency: 'EUR' } }, payments: [{ key: 'hotel-1', role: 'hotel', status: 'SENT', what: 'Night 1 hotel', amount: 180, currency: 'EUR', payeeName: 'Airport Hotel Frankfurt GmbH' }], approvals: [], summary: null };
  emails.onChange(before, after);
  await new Promise((r) => setTimeout(r, 10));
  const subjects = sent.slice(1).map((m) => m.subject);
  assert.deepEqual(subjects, ['Your Detour card is ready for Frankfurt', 'Your hotel is paid: Airport Hotel Frankfurt']);
  emails.onChange(after, after);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sent.length, 3, 'no repeats when nothing changed');
});
