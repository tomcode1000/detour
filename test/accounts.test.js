import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Accounts, checkFlights } from '../src/accounts.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const setup = () => {
  const policy = load('config/policy.json');
  const scenario = load('scenarios/ada-frankfurt.json');
  return { policy, accounts: new Accounts({ policy, scenario }) };
};
const flight = { id: 'LH403', from: 'FRA', to: 'JFK', dep: new Date(Date.now() + 7 * 864e5).toISOString() }; // always a week ahead

test('the demo starts with the company and no trips', () => {
  const { accounts } = setup();
  const v = accounts.view();
  assert.equal(v.company.name, 'Northwind Robotics');
  assert.equal(v.company.password, undefined);
  assert.deepEqual(v.invites, []);
  assert.equal(v.liveReady, false);
});

test("inviting Ada links her to the scripted trip, and the story is ready once she registers", () => {
  const { accounts } = setup();
  const inv = accounts.invite({ name: 'Ada Lim', email: 'ada.lim@northwind.example', flights: [flight] });
  assert.equal(inv.live, true);
  assert.deepEqual(inv.flights.map((f) => f.id), ['DA779', 'DA908']);
  assert.equal(accounts.liveReady(), false);
  accounts.register({ token: inv.token, phone: '+65 9123 4567', bank: { country: 'SG', holder: 'Ada Lim', account: '1234567890', code: 'DBSSSGSG' } });
  assert.equal(accounts.liveReady(), true);
  accounts.reset();
  assert.equal(accounts.liveReady(), false);
});

test('sign-up sets the company and the policy, and reset puts the demo back', () => {
  const { policy, accounts } = setup();
  accounts.signup({ company: 'Acme', manager: 'Jo Bloggs', email: 'jo@acme.example', password: 'longenough', policy: { auto_nights: 2, max_auto_raise_pct: 75, cities: { FRA: { meals: 70, transport: 40, lodging: 160 } } } });
  assert.equal(policy.company, 'Acme');
  assert.equal(policy.rules.auto_nights, 2);
  assert.equal(policy.cities.FRA.meals_per_day, 70);
  assert.ok(accounts.signin({ email: 'jo@acme.example', password: 'longenough' }));
  assert.throws(() => accounts.signin({ email: 'jo@acme.example', password: 'wrong-password' }), /not right/);
  assert.throws(() => accounts.signin({ demo: true }), /replaced/);
  accounts.reset();
  assert.equal(policy.rules.auto_nights, 1);
  assert.equal(policy.cities.FRA.meals_per_day, 60);
  assert.match(policy.company, /Northwind/);
});

test('sign-up and policy edits reject bad input', () => {
  const { accounts } = setup();
  const ok = { company: 'Acme', manager: 'Jo', email: 'jo@acme.example', password: 'longenough', policy: { auto_nights: 1, max_auto_raise_pct: 50 } };
  assert.throws(() => accounts.signup({ ...ok, email: 'nope' }), /email/);
  assert.throws(() => accounts.signup({ ...ok, password: 'short' }), /8 characters/);
  assert.throws(() => accounts.updatePolicy({ auto_nights: 9, max_auto_raise_pct: 50 }), /between 0 and 5/);
  assert.throws(() => accounts.updatePolicy({ auto_nights: 1, max_auto_raise_pct: 50, cities: { FRA: { meals: -1, transport: 1, lodging: 1 } } }), /meals/);
});

test('an invite can be found by email or link, and registration keeps only the last four digits', () => {
  const { accounts } = setup();
  const inv = accounts.invite({ name: 'Lena Hart', email: 'Lena@Northwind.example', flights: [flight] });
  assert.equal(inv.email, 'lena@northwind.example');
  assert.equal(accounts.find({ email: 'lena@northwind.example' }).token, inv.token);
  assert.equal(accounts.find({ token: inv.token }).name, 'Lena Hart');
  assert.throws(() => accounts.invite({ name: 'Lena', email: 'lena@northwind.example', flights: [flight] }), /already has a trip/);
  const reg = accounts.register({ token: inv.token, phone: '+49 151 2345678', bank: { country: 'DE', holder: 'Lena Hart', account: 'DE89 3704 0044 0532 0130 00', code: 'cobadeff' } });
  assert.deepEqual(reg.bank, { country: 'DE', holder: 'Lena Hart', last4: '3000', code: 'COBADEFF' });
  assert.equal(JSON.stringify(accounts.view()).includes('0532'), false);
  assert.equal(accounts.view().invites.find((i) => i.token === inv.token).registered, true);
});

test('invites need a real flight, and unknown or expired invites are refused', () => {
  const { accounts } = setup();
  assert.throws(() => accounts.invite({ name: 'X', email: 'x@y.example', flights: [] }), /at least one flight/);
  assert.throws(() => accounts.invite({ name: 'X', email: 'x@y.example', flights: [{ ...flight, id: '??' }] }), /flight number/);
  assert.throws(() => accounts.invite({ name: 'X', email: 'x@y.example', flights: [{ ...flight, from: 'Frankfurt' }] }), /airport codes/);
  assert.throws(() => accounts.find({ email: 'nobody@y.example' }), /no trip/);
  const inv = accounts.invite({ name: 'X', email: 'x@y.example', flights: [flight] });
  accounts.invites.find((i) => i.token === inv.token).expiresAt = Date.now() - 1;
  assert.equal(accounts.find({ token: inv.token }).expired, true);
  assert.throws(() => accounts.register({ token: inv.token, phone: '+1 555 0100 222', bank: { holder: 'X', account: '12345678', code: 'X' } }), /expired/);
});

test('an invite can be sent again with a fresh link, or removed with its registration', () => {
  const { accounts } = setup();
  const inv = accounts.invite({ name: 'Lena Hart', email: 'lena@northwind.example', flights: [flight] });
  const again = accounts.renew({ token: inv.token });
  assert.notEqual(again.token, inv.token);
  assert.throws(() => accounts.find({ token: inv.token }), /not valid/);
  assert.equal(accounts.find({ token: again.token }).email, 'lena@northwind.example');
  accounts.register({ token: again.token, phone: '+49 151 2345678', bank: { country: 'DE', holder: 'Lena Hart', account: '12345678', code: 'COBADEFF' } });
  accounts.remove({ token: again.token });
  assert.equal(accounts.view().invites.length, 0);
  assert.throws(() => accounts.find({ email: 'lena@northwind.example' }), /no trip/);
  assert.equal(accounts.registrations.size, 0);
});

test('flights are checked: real airports, not in the past, and connections that link up', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  const leg = (id, from, to, dep, arr) => ({ id, from, to, dep, arr });
  assert.doesNotThrow(() => checkFlights([leg('SQ26', 'SIN', 'FRA', '2026-11-10T15:00:00Z', '2026-11-11T05:00:00Z'), leg('LH900', 'FRA', 'LHR', '2026-11-11T07:00:00Z')], now));
  assert.throws(() => checkFlights([leg('XX1', 'SIN', 'ZZZ', '2026-11-10T15:00:00Z')], now), /doesn't know the airport ZZZ/);
  assert.throws(() => checkFlights([leg('XX1', 'SIN', 'SIN', '2026-11-10T15:00:00Z')], now), /same airport/);
  assert.throws(() => checkFlights([leg('XX1', 'SIN', 'FRA', '2026-10-01T15:00:00Z')], now), /in the past/);
  assert.throws(() => checkFlights([leg('XX1', 'SIN', 'FRA', '2026-11-10T15:00:00Z'), leg('XX2', 'MUC', 'LHR', '2026-11-11T07:00:00Z')], now), /must link up/);
  assert.throws(() => checkFlights([leg('XX1', 'SIN', 'FRA', '2026-11-10T15:00:00Z', '2026-11-11T05:00:00Z'), leg('XX2', 'FRA', 'LHR', '2026-11-11T04:00:00Z')], now), /leaves before flight 1 lands/);
  assert.throws(() => checkFlights([leg('XX1', 'SIN', 'FRA', '2026-11-10T15:00:00Z'), leg('XX2', 'FRA', 'LHR', '2026-11-20T07:00:00Z')], now), /separate trip/);
});

test('the traveller can say the trip is not theirs, and the manager sees it', () => {
  const { accounts } = setup();
  const inv = accounts.invite({ name: 'Lena Hart', email: 'lena@northwind.example', flights: [flight] });
  accounts.dispute({ token: inv.token });
  assert.ok(accounts.view().invites[0].disputed.at);
  assert.ok(accounts.find({ token: inv.token }).disputed);
});
