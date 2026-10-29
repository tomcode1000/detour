import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as rules from '../src/rules.js';
import { cutoffsCrossed } from '../src/time.js';

const policy = JSON.parse(readFileSync(new URL('../config/policy.json', import.meta.url)));
const FRA = policy.cities.FRA;
const t = (iso) => Date.parse(iso);

const flight = (id, from, to, dep, arr, extra = {}) => ({
  id, from, to, status: 'SCHEDULED', sched_dep: t(dep), sched_arr: t(arr), est_dep: t(dep), est_arr: t(arr), ...extra,
});

test('nights count 23:00 Frankfurt cut-offs, not UTC midnights', () => {
  // 23:00 CET on 5 Nov is 22:00 UTC.
  assert.equal(cutoffsCrossed(t('2026-11-05T10:00Z'), t('2026-11-05T21:59Z'), 'Europe/Berlin'), 0);
  assert.equal(cutoffsCrossed(t('2026-11-05T10:00Z'), t('2026-11-05T22:00Z'), 'Europe/Berlin'), 1);
  assert.equal(cutoffsCrossed(t('2026-11-05T10:00Z'), t('2026-11-07T08:40Z'), 'Europe/Berlin'), 2);
});

test('summer time is handled (23:00 CEST is 21:00 UTC)', () => {
  assert.equal(cutoffsCrossed(t('2026-07-01T10:00Z'), t('2026-07-01T21:00Z'), 'Europe/Berlin'), 1);
  assert.equal(cutoffsCrossed(t('2026-07-01T10:00Z'), t('2026-07-01T20:59Z'), 'Europe/Berlin'), 0);
});

test('on-time trip is not disrupted', () => {
  const flights = {
    A: flight('A', 'SIN', 'FRA', '2026-11-05T04:30Z', '2026-11-05T16:45Z'),
    B: flight('B', 'FRA', 'LHR', '2026-11-05T18:50Z', '2026-11-05T19:40Z'),
  };
  assert.equal(rules.detectDisruption(['A', 'B'], flights, policy), null);
});

test('late inbound flight is a missed connection at the hub', () => {
  const flights = {
    A: flight('A', 'SIN', 'FRA', '2026-11-05T04:30Z', '2026-11-05T16:45Z', { status: 'DEPARTED', est_arr: t('2026-11-05T19:05Z') }),
    B: flight('B', 'FRA', 'LHR', '2026-11-05T18:50Z', '2026-11-05T19:40Z'),
  };
  const d = rules.detectDisruption(['A', 'B'], flights, policy);
  assert.equal(d.airport, 'FRA');
  assert.equal(d.legIndex, 1);
  assert.match(d.reason, /arrives too late/);
});

test('cancellation and long delay are disruptions; a short delay is not', () => {
  const base = () => ({ A: flight('A', 'FRA', 'LHR', '2026-11-05T18:50Z', '2026-11-05T19:40Z') });
  const cancelled = base(); cancelled.A.status = 'CANCELLED';
  assert.match(rules.detectDisruption(['A'], cancelled, policy).reason, /cancelled/);
  const late = base(); late.A.est_dep = t('2026-11-05T21:00Z');
  assert.match(rules.detectDisruption(['A'], late, policy).reason, /delayed 2.2h/);
  const bit = base(); bit.A.est_dep = t('2026-11-05T19:50Z');
  assert.equal(rules.detectDisruption(['A'], bit, policy), null);
});

test('day card: meals + taxis only, 120 EUR', () => {
  const c = rules.planControls({ nights: 0, city: FRA, policy, activeFrom: 0, activeTo: 1 });
  assert.equal(c.limit, 120);
  assert.equal(c.currency, 'EUR');
  assert.deepEqual(c.categories, ['meals', 'transport']);
  assert.ok(!c.mccs.includes('7011'));
});

test('one night adds the hotel at city rate x 1.2', () => {
  const c = rules.planControls({ nights: 1, city: FRA, policy, activeFrom: 0, activeTo: 1 });
  assert.equal(c.limit, 60 * 2 + 60 + 150 * 1.2);
  assert.ok(c.mccs.includes('7011'));
});

test('the second night needs the travel manager; the first does not', () => {
  const one = rules.planControls({ nights: 1, city: FRA, policy, activeFrom: 0, activeTo: 1 });
  const two = rules.planControls({ nights: 2, city: FRA, policy, activeFrom: 0, activeTo: 1 });
  assert.equal(rules.needsApproval(null, one, 0, policy), null);
  assert.match(rules.needsApproval(one, two, 0, policy), /night 2 needs approval/);
  assert.equal(rules.needsApproval(one, two, 2, policy), null);
});

test('card expires 6h after the confirmed departure; provisional window moves in whole days', () => {
  const start = t('2026-11-05T10:00Z');
  assert.equal(rules.activeUntil({ start, next: t('2026-11-06T08:40Z'), now: start, policy }), t('2026-11-06T14:40Z'));
  assert.equal(rules.activeUntil({ start, next: null, now: start, policy }), t('2026-11-06T10:00Z'));
  assert.equal(rules.activeUntil({ start, next: null, now: t('2026-11-05T20:00Z'), policy }), t('2026-11-06T10:00Z'));
  assert.equal(rules.activeUntil({ start, next: null, now: t('2026-11-06T05:00Z'), policy }), t('2026-11-07T10:00Z'));
});

test('traveller requests: covered, small raise, big raise, wrong category', () => {
  const controls = rules.planControls({ nights: 1, city: FRA, policy, activeFrom: 0, activeTo: 1 }); // 360
  const card = { status: 'ACTIVE', controls };
  const ask = (category, amount, spent = 0) => rules.evaluateRequest({ card, spent, request: { category, amount }, policy }).result;
  assert.equal(ask('lodging', 150), 'covered');
  assert.equal(ask('lodging', 150, 300), 'raise');      // 60 left, raise 90 <= 180
  assert.equal(ask('lodging', 600, 300), 'escalate');   // raise 540 > 50% of 360
  assert.equal(ask('other', 50), 'reject');
});

test('hotel request on a day card goes to the manager', () => {
  const controls = rules.planControls({ nights: 0, city: FRA, policy, activeFrom: 0, activeTo: 1 });
  const r = rules.evaluateRequest({ card: { status: 'ACTIVE', controls }, spent: 0, request: { category: 'lodging', amount: 100 }, policy });
  assert.equal(r.result, 'escalate');
});
