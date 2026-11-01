import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Accounts } from '../src/accounts.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const setup = () => {
  const policy = load('config/policy.json');
  const scenario = load('scenarios/ada-frankfurt.json');
  return { policy, accounts: new Accounts({ policy, scenario }) };
};
const flight = { id: 'LH403', from: 'FRA', to: 'JFK', dep: '2026-11-12T08:30:00Z' };

test('the demo company and Ada\'s invite exist from the start', () => {
  const { accounts } = setup();
  const v = accounts.view();
  assert.equal(v.company.name, 'Northwind Robotics');
  assert.equal(v.company.password, undefined);
  assert.equal(v.invites[0].email, 'ada.lim@northwind.example');
  assert.equal(v.invites[0].registered, false);
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
