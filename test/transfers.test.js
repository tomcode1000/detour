// The same Ada story funded by transfers: allowance to Ada, hotel paid directly,
// later days scheduled and cancelled when she no longer needs them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Engine } from '../src/engine.js';
import { createFunding } from '../src/funding/index.js';
import { paymentsFor } from '../src/funding/transfers.js';
import { createStandinAgent } from '../src/agent/standin.js';

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const policy = load('../config/policy.json');
const scenario = load('../scenarios/ada-frankfurt.json');
const env = { FUNDING: 'transfers-local' };

function engine() {
  return new Engine({
    scenario, policy, agent: createStandinAgent(), runId: 'test',
    makeFunding: ({ clock, runKey }) => createFunding({ env, clock, runKey, scenario, policy }),
  });
}
async function playUntil(e, predicate) {
  while (!e.finished && !predicate(e)) if (!(await e.step())) break;
}
const ledger = (e) => e.funding.ledger();
const byKey = (e, key) => ledger(e).filter((l) => l.key === key).at(-1);

test('payment plan: day 1 now, later days 06:00 local, hotel nights 20:00 local, nothing after the trip', () => {
  const start = Date.parse('2026-11-05T10:00:00Z');
  const plan = paymentsFor({
    tz: 'Europe/Berlin', activeFrom: start, activeTo: Date.parse('2026-11-06T14:40:00Z'), nights: 1, currency: 'EUR',
    breakdown: { meals: 120, transport: 60, lodging: 180, extras: 0 },
  });
  const at = Object.fromEntries(plan.map((p) => [p.key, new Date(p.payAt).toISOString()]));
  assert.deepEqual(Object.keys(at).sort(), ['hotel-1', 'meals-1', 'meals-2', 'transport']);
  assert.equal(at['meals-1'], '2026-11-05T10:00:00.000Z');
  assert.equal(at['meals-2'], '2026-11-06T05:00:00.000Z'); // 06:00 CET
  assert.equal(at['hotel-1'], '2026-11-05T19:00:00.000Z'); // 20:00 CET
  assert.equal(plan.find((p) => p.key === 'hotel-1').role, 'hotel');
});

test('Ada by transfer: paid before she lands, hotel paid direct, unneeded days cancelled', async () => {
  const e = engine();
  assert.equal(e.mode, 'transfer');

  // Missed connection -> 60 meals + 60 taxis sent to Ada at once, in SGD.
  await playUntil(e, (x) => x.card);
  assert.deepEqual(ledger(e).map((l) => [l.key, l.status, l.amount]), [['meals-1', 'SENT', 60], ['transport', 'SENT', 60]]);
  assert.equal(byKey(e, 'meals-1').received.currency, 'SGD');
  assert.match(e.messages.at(-1).text, /sent you 120 EUR/);

  // Till payments are card-only scenes and are skipped.
  await playUntil(e, (x) => x.legs.includes('DA902'));
  assert.equal(e.transactions.length, 0);

  // Rebooked to tomorrow -> hotel night 1 paid directly now; tomorrow's meals scheduled.
  assert.equal(byKey(e, 'hotel-1').status, 'SENT');
  assert.equal(byKey(e, 'hotel-1').role, 'hotel');
  assert.equal(byKey(e, 'meals-2').status, 'SCHEDULED');

  // Night 2 needs the manager; nothing for it is scheduled before approval.
  await playUntil(e, (x) => x.waiting && x.approvals.some((a) => a.status === 'PENDING'));
  assert.equal(byKey(e, 'meals-2').status, 'SENT', 'tomorrow 06:00 has passed, so it was paid');
  assert.equal(byKey(e, 'hotel-2'), undefined);
  await e.decide(e.approvals.find((a) => a.status === 'PENDING').id, 'approve');
  assert.equal(byKey(e, 'hotel-2').status, 'SCHEDULED');
  assert.equal(byKey(e, 'meals-3').status, 'SCHEDULED');

  // Earlier seat -> night 2 hotel and day 3 meals cancelled before they are paid.
  await playUntil(e, (x) => x.legs.includes('DA910'));
  assert.equal(byKey(e, 'hotel-2').status, 'CANCELLED');
  assert.equal(byKey(e, 'meals-3').status, 'CANCELLED');
  assert.match(e.messages.at(-1).text, /DA910.*cancelled.*240 EUR/s);

  await playUntil(e, (x) => x.finished);
  assert.equal(e.summary.toTraveller, 180);
  assert.equal(e.summary.toHotel, 180);
  assert.equal(e.summary.cancelled, 240);
  assert.equal(e.log.filter((l) => l.source === 'error').length, 0, JSON.stringify(e.log.filter((l) => l.source === 'error')));
});

test('hotel deposit question: the hotel is already paid directly', async () => {
  const e = engine();
  await playUntil(e, (x) => x.card?.controls.nights === 1);
  await e.chat('The hotel wants a 150 EUR deposit');
  assert.match(e.messages.at(-1).text, /already paid directly/);
});

test('a small extra for food is sent straight away; a big one goes to the manager', async () => {
  const e = engine();
  await playUntil(e, (x) => x.card?.controls.nights === 1);
  await e.chat('Dinner here costs more, I need 40 EUR more for food');
  assert.equal(byKey(e, 'extra-1').amount, 40);
  assert.equal(byKey(e, 'extra-1').status, 'SENT');
  await e.chat('I need 500 EUR for food');
  assert.equal(e.approvals.at(-1).kind, 'raise');
  assert.equal(e.approvals.at(-1).status, 'PENDING');
});
