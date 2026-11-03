import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { schemeFor, compensationFor, distanceKm } from '../src/claims.js';
import { Engine } from '../src/engine.js';
import { createFunding } from '../src/funding/index.js';
import { createStandinAgent } from '../src/agent/standin.js';

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));

test('which law covers a journey', () => {
  assert.equal(schemeFor('FRA', 'JFK', 'OTHER'), 'EU261');          // leaving the EU: any airline
  assert.equal(schemeFor('LHR', 'SIN', 'OTHER'), 'UK261');          // leaving the UK: any airline
  assert.equal(schemeFor('SIN', 'FRA', 'EU'), 'EU261');             // into the EU on an EU airline
  assert.equal(schemeFor('SIN', 'FRA', 'OTHER'), null);             // into the EU on a non-EU airline
  assert.equal(schemeFor('SIN', 'LHR', 'EU'), 'UK261');             // into the UK on an EU airline
  assert.equal(schemeFor('JFK', 'SIN', 'EU'), null);                // nowhere near either
});

test('compensation bands, and the half rate for shorter delays', () => {
  assert.equal(compensationFor('EU261', 900, 200).amount, 250);
  assert.equal(compensationFor('EU261', 2500, 200).amount, 400);
  assert.equal(compensationFor('EU261', 6000, 300).amount, 600);
  assert.equal(compensationFor('EU261', 6000, 200).amount, 300);    // over 3 h but under 4 h
  assert.equal(compensationFor('UK261', 10800, 1305).amount, 520);
  assert.equal(compensationFor('UK261', 10800, 120).amount, 0);     // under 3 h: nothing
  assert.ok(Math.abs(distanceKm('SIN', 'LHR') - 10880) < 60);
});

test("Ada's trip ends with a claim: UK261 compensation for her, care costs back to the company", async () => {
  const policy = load('../config/policy.json');
  const scenario = load('../scenarios/ada-frankfurt.json');
  const e = new Engine({ scenario, policy, agent: createStandinAgent(), runId: 'test',
    makeFunding: ({ clock, runKey }) => createFunding({ env: { FUNDING: 'hotel-card-local' }, clock, runKey, scenario, policy }) });
  while (!e.finished) {
    if (e.waiting && e.approvals.some((a) => a.status === 'PENDING')) { await e.decide(e.approvals.find((a) => a.status === 'PENDING').id, 'approve'); continue; }
    if (!(await e.step())) break;
  }
  const c = e.claim;
  assert.equal(c.scheme, 'UK261');
  assert.equal(c.compensation.amount, 520);
  assert.equal(c.compensation.currency, 'GBP');
  assert.equal(c.care.total, 360);
  assert.equal(c.care.owedTo, policy.company);
  assert.ok(c.delayMins > 20 * 60);
  assert.match(c.letter, /Article 7/);
  assert.match(c.letter, /refund them to/);
  assert.match(e.messages.at(-1).text, /520/);
});

test("compensation stays the traveller's by default; a company policy can ask for it to be passed on", async () => {
  const run = async (compensationTo) => {
    const policy = load('../config/policy.json');
    policy.rules.compensation_to = compensationTo;
    const scenario = load('../scenarios/ada-frankfurt.json');
    const e = new Engine({ scenario, policy, agent: createStandinAgent(), runId: 'test',
      makeFunding: ({ clock, runKey }) => createFunding({ env: { FUNDING: 'meal-card-local' }, clock, runKey, scenario, policy }) });
    while (!e.finished) {
      if (e.waiting && e.approvals.some((a) => a.status === 'PENDING')) { await e.decide(e.approvals.find((a) => a.status === 'PENDING').id, 'approve'); continue; }
      if (!(await e.step())) break;
    }
    return e;
  };
  const keep = await run('traveller');
  assert.equal(keep.claim.compensation.passOn, false);
  assert.doesNotMatch(keep.messages.at(-1).text, /pass on/);
  const pass = await run('company');
  assert.equal(pass.claim.compensation.passOn, true);
  assert.equal(pass.claim.compensation.amount, 520, 'the amount is set by law either way');
  assert.equal(pass.claim.care.total, keep.claim.care.total, 'care costs are separate and unchanged');
  assert.match(pass.messages.at(-1).text, /pass on to the company/);
  assert.equal(pass.claim.letter, keep.claim.letter, 'the letter to the airline is the same: it claims in the passenger name');
});
