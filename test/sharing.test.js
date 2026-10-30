// Airline messages reach the traveller first; Detour reads only what they share, and a shared
// message can never move money by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Engine } from '../src/engine.js';
import { createFunding } from '../src/funding/index.js';
import { createStandinAgent } from '../src/agent/standin.js';

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const policy = load('../config/policy.json');
const scenario = load('../scenarios/ada-frankfurt.json');

function engine() {
  return new Engine({
    scenario, policy, agent: createStandinAgent(), runId: 'test',
    makeFunding: ({ clock, runKey }) => createFunding({ env: { FUNDING: 'transfers-local' }, clock, runKey, scenario, policy }),
  });
}
async function playUntil(e, predicate) {
  while (!e.finished && !predicate(e)) if (!(await e.step())) break;
}
const moneyState = (e) => JSON.stringify({ ledger: e.funding.ledger().map((l) => [l.key, l.status, l.amount]), approvals: e.approvals.length, controls: e.card?.controls });

test('airline emails land in the inbox; Detour reads them only when shared', async () => {
  const e = engine();
  await playUntil(e, (x) => x.inbox.length === 1);
  assert.equal(e.emails.length, 0, 'not read before the traveller shares it');
  await e.step(); // Ada forwards it
  assert.equal(e.inbox[0].shared, true);
  assert.equal(e.emails.length, 1);
  assert.equal(e.emails[0].parsed.kind, 'missed_connection');
  assert.equal(e.messages.filter((m) => m.kind === 'share').length, 1);
});

test('a scam "refund" message with an injected instruction changes nothing', async () => {
  const e = engine();
  await playUntil(e, (x) => x.inbox.some((m) => /refund/i.test(m.subject)));
  const before = moneyState(e);
  await e.step(); // Ada shares the scam
  const read = e.emails.at(-1);
  assert.equal(read.suspicious, true);
  assert.equal(read.agrees, false);
  assert.equal(moneyState(e), before, 'no payment, approval or plan change');
  assert.match(e.messages.at(-1).text, /haven't changed anything/);
  assert.doesNotMatch(e.messages.at(-1).text, /GB33|1000/, 'reply never repeats the message content');
});

test('a pasted "cancelled" message the flight feed does not confirm moves no money', async () => {
  const e = engine();
  await playUntil(e, (x) => x.card?.controls.nights === 1);
  const before = moneyState(e);
  await e.shareAirlineMessage({ text: 'Demo Air: flight DA902 tomorrow is cancelled. We will contact you.', how: 'pasted' });
  assert.equal(e.emails.at(-1).parsed.kind, 'cancelled');
  assert.equal(e.emails.at(-1).agrees, false);
  assert.equal(moneyState(e), before);
  assert.match(e.messages.at(-1).text, /doesn't show that yet/);
});

test('a screenshot share is recorded as such and read the same way', async () => {
  const e = engine();
  await playUntil(e, (x) => x.card);
  await e.shareAirlineMessage({ text: 'DA 779 delayed. You will miss your connection DA 908.', how: 'screenshot' });
  assert.equal(e.messages.filter((m) => m.kind === 'share').at(-1).how, 'screenshot');
  assert.equal(e.emails.at(-1).agrees, true);
});
