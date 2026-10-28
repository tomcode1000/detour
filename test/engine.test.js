// Plays the whole Ada scenario with the local funding simulation and the stand-in agent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Engine } from '../src/engine.js';
import { createLocalFunding } from '../src/funding/local.js';
import { createStandinAgent } from '../src/agent/standin.js';

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const policy = load('../config/policy.json');
const scenario = load('../scenarios/ada-frankfurt.json');

function engine() {
  return new Engine({ scenario, policy, makeFunding: ({ clock }) => createLocalFunding({ clock }), agent: createStandinAgent(), runId: 'test' });
}

async function playUntil(e, predicate) {
  while (!e.finished && !predicate(e)) {
    const moved = await e.step();
    if (!moved) break;
  }
}

test('Ada: full disruption from missed connection to closed card', async () => {
  const e = engine();

  // Missed connection -> day card 120 EUR, meals + taxis.
  await playUntil(e, (x) => x.card);
  assert.equal(e.card.controls.limit, 120);
  assert.equal(e.card.controls.currency, 'EUR');
  assert.deepEqual(e.card.controls.categories, ['meals', 'transport']);
  assert.equal(e.disruption.airport, 'FRA');

  // Dinner approved, electronics declined.
  await playUntil(e, (x) => x.transactions.length === 2);
  assert.equal(e.transactions[0].status, 'APPROVED');
  assert.equal(e.transactions[1].status, 'DECLINED');
  assert.equal(e.transactions[1].reason, 'MERCHANT_CATEGORY_NOT_ALLOWED');

  // Rebooked to tomorrow -> hotel added automatically, 360 EUR, until 6h after departure.
  await playUntil(e, (x) => x.card.controls.nights === 1);
  assert.equal(e.card.controls.limit, 360);
  assert.ok(e.card.controls.categories.includes('lodging'));
  assert.equal(e.card.controls.activeTo, Date.parse('2026-11-06T14:40:00Z'));

  // Hotel 140 then incremental +40, both approved.
  await playUntil(e, (x) => x.transactions.length === 4);
  assert.deepEqual(e.transactions.slice(2).map((t) => t.status), ['APPROVED', 'APPROVED']);

  // Second rebooking -> night 2 needs the travel manager; the story waits.
  await playUntil(e, (x) => x.progress?.waiting || (x.waiting && x.approvals.some((a) => a.status === 'PENDING')));
  const pending = e.approvals.filter((a) => a.status === 'PENDING');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].to.nights, 2);
  assert.equal(e.card.controls.nights, 1, 'card must not change before approval');
  assert.equal(await e.step(), false, 'story must not move on while approval is pending');

  // Ada's message while it is pending gets a "manager is looking" answer, not a second request.
  assert.match(e.messages.at(-1).text, /already looking/);

  // Manager approves -> 600 EUR, until 6h after DA906.
  await e.decide(pending[0].id, 'approve');
  assert.equal(e.card.controls.nights, 2);
  assert.equal(e.card.controls.limit, 600);
  assert.equal(e.card.controls.activeTo, Date.parse('2026-11-07T14:40:00Z'));

  // A seat opens this afternoon -> back to one night, card ends 6h after DA910.
  await playUntil(e, (x) => x.legs.includes('DA910'));
  assert.equal(e.card.controls.nights, 1);
  assert.equal(e.card.controls.limit, 360);
  assert.equal(e.card.controls.activeTo, Date.parse('2026-11-06T22:30:00Z'));

  // Departs -> card off; lands -> closed with a summary.
  await playUntil(e, (x) => x.finished);
  assert.equal(e.card.status, 'CLOSED');
  assert.equal(e.summary.spent, 18.4 + 140 + 40);
  assert.equal(e.summary.declined, 1);
  assert.equal(e.log.filter((l) => l.source === 'error').length, 0, JSON.stringify(e.log.filter((l) => l.source === 'error')));
});

test('a purchase after departure is refused because the card is off', async () => {
  const e = engine();
  await playUntil(e, (x) => x.waiting && x.approvals.some((a) => a.status === 'PENDING'));
  await e.decide(e.approvals.find((a) => a.status === 'PENDING').id, 'approve');
  await playUntil(e, (x) => x.card.status === 'INACTIVE');
  const tx = await e.tryPurchase({ merchant: 'Taxi', mcc: '4121', amount: 20, currency: 'EUR' });
  assert.equal(tx.reason, 'CARD_INACTIVE');
});

test('declining the second night keeps the one-night card and does not ask again', async () => {
  const e = engine();
  await playUntil(e, (x) => x.waiting && x.approvals.some((a) => a.status === 'PENDING'));
  await e.decide(e.approvals.find((a) => a.status === 'PENDING').id, 'decline');
  assert.equal(e.card.controls.nights, 1);
  await playUntil(e, (x) => x.finished);
  assert.equal(e.approvals.filter((a) => a.kind === 'nights').length, 1);
});

test('traveller asks for a deposit the card already covers', async () => {
  const e = engine();
  await playUntil(e, (x) => x.card?.controls.nights === 1);
  await e.chat('The hotel wants a 150 EUR deposit');
  assert.match(e.messages.at(-1).text, /already covers/);
});

test('a request for something Detour does not pay for is refused', async () => {
  const e = engine();
  await playUntil(e, (x) => x.card);
  await e.chat('Can I get 300 EUR for a new laptop?');
  assert.match(e.messages.at(-1).text, /Sorry/);
  assert.equal(e.approvals.length, 0);
});
