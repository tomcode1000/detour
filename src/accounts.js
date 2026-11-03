// Accounts for the demo server: the company and its travel manager, trip invites, and travellers'
// registrations. Kept in memory and restored to the demo company on reset, because every visitor
// shares one demo. Bank details are reduced to the last four digits before they are stored.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { AIRPORTS } from './claims.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FLIGHT = /^[A-Z0-9]{2}\s?\d{1,4}[A-Z]?$/i;
const AIRPORT = /^[A-Z]{3}$/;
const INVITE_DAYS = 14;
const DAY = 864e5;

// What Detour can check without a flight-status service: real airport codes, a departure that is
// not in the past, flights in time order, and connections that link up. Flights less than 24 hours
// apart are a connection, so the next one must leave from where the last one landed. A longer gap is
// a stay (a return days later, or home from another city), so it may leave from anywhere.
// A live version would also ask a flight-status service that each flight exists on that date.
export function checkFlights(flights, now = Date.now()) {
  flights.forEach((f, i) => {
    const n = flights.length > 1 ? `Flight ${i + 1}: ` : '';
    if (!FLIGHT.test(f.id)) throw new Error(`${n}use a flight number like LH403.`);
    if (!AIRPORT.test(f.from) || !AIRPORT.test(f.to)) throw new Error(`${n}use three-letter airport codes like FRA.`);
    for (const code of [f.from, f.to]) if (!AIRPORTS[code]) throw new Error(`${n}Detour doesn't know the airport ${code} yet. Check the code.`);
    if (f.from === f.to) throw new Error(`${n}it leaves from and lands at the same airport.`);
    if (!f.dep) throw new Error(`${n}add the departure date and time.`);
    if (Date.parse(f.dep) < now - DAY) throw new Error(`${n}that departure is in the past. Check the date.`);
    if (f.arr && Date.parse(f.arr) <= Date.parse(f.dep)) throw new Error(`${n}it lands before it leaves. Check the times.`);
    const prev = flights[i - 1];
    if (!prev) return;
    const gap = Date.parse(f.dep) - Date.parse(prev.arr || prev.dep);
    if (gap <= 0) throw new Error(`Flight ${i + 1} leaves before flight ${i}${prev.arr ? ' lands' : ' leaves'}. Check the dates and times.`);
    if (gap < DAY && prev.to !== f.from) throw new Error(`Flight ${i + 1} leaves from ${f.from} less than a day after flight ${i} lands at ${prev.to}. A connection has to leave from the airport you landed at.`);
  });
}

const clean = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const hash = (password, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
const checkHash = (password, stored) => {
  const [salt, key] = stored.split(':');
  const a = Buffer.from(key, 'hex');
  const b = scryptSync(password, salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
};

export class Accounts {
  constructor({ policy, scenario }) {
    this.policy = policy;
    this.scenario = scenario;
    // What sign-up may change in the policy, kept so a reset can put the demo values back.
    this.seedPolicy = JSON.stringify({ company: policy.company, travel_manager: policy.travel_manager, rules: policy.rules, cities: policy.cities });
    this.reset();
  }

  reset() {
    const seed = JSON.parse(this.seedPolicy);
    Object.assign(this.policy, { company: seed.company, travel_manager: seed.travel_manager });
    Object.assign(this.policy.rules, seed.rules);
    for (const [code, c] of Object.entries(seed.cities)) Object.assign(this.policy.cities[code], c);

    this.company = {
      name: this.policy.company.replace(/\s*\(.*\)/, ''),
      manager: this.policy.travel_manager,
      email: 'sam.rivera@northwind.example',
      country: 'SG',
      currency: 'EUR',
      password: null,
      demo: true,
    };
    // No trips yet: the demo starts with the travel manager adding Ada's trip.
    this.invites = [];
    this.registrations = new Map();
  }

  // The scripted disruption follows the scenario's traveller, so it can start once she is invited and registered.
  liveReady() {
    const inv = this.invites.find((i) => i.live);
    return Boolean(inv && this.registrations.has(inv.email));
  }

  view() {
    const { password, ...company } = this.company;
    return {
      liveReady: this.liveReady(),
      liveEmail: this.scenario.traveller.email,
      company,
      invites: this.invites.map((i) => ({ ...i, registered: this.registrations.has(i.email) })),
    };
  }

  signup(b) {
    const company = clean(b.company, 80);
    const manager = clean(b.manager, 80);
    const email = clean(b.email, 120).toLowerCase();
    const password = String(b.password ?? '');
    if (!company || !manager) throw new Error('Add your company name and your name.');
    if (!EMAIL.test(email)) throw new Error('That email address does not look right.');
    if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
    const apply = this.checkPolicy(b.policy);

    this.company = { name: company, manager, email, country: clean(b.country, 2).toUpperCase() || 'SG', currency: clean(b.currency, 3).toUpperCase() || 'EUR', password: hash(password), demo: false };
    this.policy.company = company;
    this.policy.travel_manager = manager;
    apply();
    return this.view();
  }

  // Edits from the policy screen: same checks as sign-up.
  updatePolicy(p) {
    this.checkPolicy(p)();
    return this.view();
  }

  // Validates policy input and returns a function that applies it.
  checkPolicy(p = {}) {
    const nights = Number(p.auto_nights);
    const raise = Number(p.max_auto_raise_pct);
    if (!Number.isInteger(nights) || nights < 0 || nights > 5) throw new Error('Nights covered automatically must be between 0 and 5.');
    if (!(raise >= 0 && raise <= 200)) throw new Error('The approval threshold must be between 0% and 200%.');
    for (const [code, r] of Object.entries(p.cities || {})) {
      if (!this.policy.cities[code]) throw new Error(`Unknown city ${code}.`);
      for (const k of ['meals', 'transport', 'lodging']) {
        if (!(Number(r[k]) > 0 && Number(r[k]) < 10000)) throw new Error(`Check the ${k} rate for ${this.policy.cities[code].city}.`);
      }
    }
    return () => {
      this.policy.rules.auto_nights = nights;
      this.policy.rules.max_auto_raise_pct = raise;
      for (const [code, r] of Object.entries(p.cities || {})) {
        Object.assign(this.policy.cities[code], { meals_per_day: Number(r.meals), transport: Number(r.transport), lodging_per_night: Number(r.lodging) });
      }
    };
  }

  signin(b) {
    if (b.demo) {
      if (!this.company.demo) throw new Error('The demo company has been replaced. Reset the demo to use it again.');
      return this.view();
    }
    const email = clean(b.email).toLowerCase();
    if (email !== this.company.email || !this.company.password || !checkHash(String(b.password ?? ''), this.company.password)) {
      throw new Error('Email or password is not right.');
    }
    return this.view();
  }

  invite(b) {
    const name = clean(b.name, 80);
    const email = clean(b.email).toLowerCase();
    if (!name) throw new Error("Add the traveller's name.");
    if (!EMAIL.test(email)) throw new Error('That email address does not look right.');
    if (this.invites.some((i) => i.email === email)) throw new Error(`${email} already has a trip.`);
    const flights = (Array.isArray(b.flights) ? b.flights : []).slice(0, 6).map((f) => ({
      id: clean(f.id, 8).toUpperCase().replace(/\s+/g, ''),
      from: clean(f.from, 8).toUpperCase(),
      to: clean(f.to, 8).toUpperCase(),
      dep: f.dep && !Number.isNaN(Date.parse(f.dep)) ? new Date(f.dep).toISOString() : null,
      arr: f.arr && !Number.isNaN(Date.parse(f.arr)) ? new Date(f.arr).toISOString() : null,
    }));
    if (!flights.length) throw new Error('Add at least one flight.');
    // The scenario's traveller gets the scenario's itinerary, because the scripted flight feed follows those flights.
    const live = email === this.scenario.traveller.email.toLowerCase();
    if (!live) checkFlights(flights);
    const trip = live
      ? this.scenario.legs.map((id) => { const f = this.scenario.flights[id]; return { id: f.id, from: f.from, to: f.to, dep: f.sched_dep, arr: f.sched_arr }; })
      : flights;
    const now = Date.now();
    const inv = { token: randomBytes(9).toString('base64url'), name, email, role: clean(b.role, 60) || 'Traveller', flights: trip, live, createdAt: now, expiresAt: now + INVITE_DAYS * 864e5 };
    this.invites.push(inv);
    return { ...inv, registered: false };
  }

  // A new link for an invite (the old one stops working), valid for another 14 days.
  renew(b) {
    const inv = this.invites.find((i) => i.token === clean(b.token, 40));
    if (!inv) throw new Error('That trip no longer exists.');
    inv.token = randomBytes(9).toString('base64url');
    inv.expiresAt = Date.now() + INVITE_DAYS * 864e5;
    return { ...inv, registered: this.registrations.has(inv.email) };
  }

  // The traveller says the trip on the invite is not theirs: the travel manager is told.
  dispute(b) {
    const inv = this.invites.find((i) => i.token === clean(b.token, 40));
    if (!inv) throw new Error('This invite link is not valid.');
    inv.disputed = { at: Date.now(), note: clean(b.note, 300) };
    return { ...inv };
  }

  remove(b) {
    const i = this.invites.findIndex((x) => x.token === clean(b.token, 40));
    if (i < 0) throw new Error('That trip no longer exists.');
    const [inv] = this.invites.splice(i, 1);
    this.registrations.delete(inv.email);
    return { removed: inv.email };
  }

  find(b) {
    const token = clean(b.token, 40);
    const email = clean(b.email).toLowerCase();
    const inv = this.invites.find((i) => (token && i.token === token) || (email && i.email === email));
    if (!inv && email === this.scenario.traveller.email.toLowerCase()) throw new Error(`Ada hasn't been invited yet. Open Detour as the travel manager and add her trip first: Trips, then Add a trip, then Use Ada's trip (demo).`);
    if (!inv) throw new Error(email ? `There is no trip for ${email} yet. Ask your travel manager to invite you.` : 'This invite link is not valid.');
    if (Date.now() > inv.expiresAt) return { ...inv, expired: true };
    return { ...inv, company: this.company.name, manager: this.company.manager, registration: this.registrations.get(inv.email) || null };
  }

  register(b) {
    const inv = this.invites.find((i) => i.token === clean(b.token, 40));
    if (!inv) throw new Error('This invite link is not valid.');
    if (Date.now() > inv.expiresAt) throw new Error('This invite has expired. Ask your travel manager for a new one.');
    const phone = clean(b.phone, 24);
    const account = clean(b.bank?.account, 34).replace(/\s+/g, '');
    if (!/^\+?[\d\s()-]{7,}$/.test(phone)) throw new Error('Add a mobile number, with the country code.');
    if (!clean(b.bank?.holder)) throw new Error('Add the account holder name.');
    if (account.length < 6) throw new Error('Add your account number.');
    if (!clean(b.bank?.code)) throw new Error('Add the bank code (SWIFT or local code).');
    const reg = {
      name: clean(b.name, 80) || inv.name,
      phone,
      homeCurrency: clean(b.homeCurrency, 3).toUpperCase() || 'SGD',
      bank: { country: clean(b.bank.country, 2).toUpperCase(), holder: clean(b.bank.holder, 80), last4: account.slice(-4), code: clean(b.bank.code, 11).toUpperCase() },
      messages: Boolean(b.messages),
      at: Date.now(),
    };
    this.registrations.set(inv.email, reg);
    return reg;
  }
}
