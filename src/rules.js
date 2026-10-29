// The rules. Every number on the card comes from here; the model can only propose.
// Pure functions: no I/O, no clock of their own, so they are easy to test.
import { cutoffsCrossed, hours } from './time.js';

const round2 = (n) => Math.round(n * 100) / 100;
const isAirborneOrDone = (f) => f.status === 'DEPARTED' || f.status === 'LANDED';

// Is the trip disrupted right now? Looks at the first leg the traveller has not flown yet.
// Returns null, or { legIndex, airport, reason }.
export function detectDisruption(legs, flights, policy) {
  const r = policy.rules;
  const legIndex = legs.findIndex((id) => !isAirborneOrDone(flights[id]));
  if (legIndex === -1) return null;
  const flight = flights[legs[legIndex]];
  const at = { legIndex, airport: flight.from };

  if (flight.status === 'CANCELLED') return { ...at, reason: `${flight.id} cancelled` };

  const delayH = (flight.est_dep - flight.sched_dep) / hours(1);
  if (delayH >= r.delay_threshold_hours) {
    return { ...at, reason: `${flight.id} delayed ${delayH.toFixed(1)}h` };
  }

  if (legIndex > 0) {
    const inbound = flights[legs[legIndex - 1]];
    const connectionMin = (flight.est_dep - inbound.est_arr) / 60e3;
    if (connectionMin < r.min_connection_minutes) {
      return { ...at, reason: `${inbound.id} arrives too late for ${flight.id} (connection ${Math.round(connectionMin)} min)` };
    }
  }
  return null;
}

// The next departure out of the stranded airport, or null if none is confirmed.
export function nextDeparture(flight) {
  return flight && flight.status !== 'CANCELLED' ? flight.est_dep : null;
}

// Nights stranded: local cut-offs (23:00) between the disruption and the next departure.
// With no departure confirmed, count the nights already passed (at least none).
export function countNights({ start, next, now, tz, policy }) {
  const cutoff = policy.rules.overnight_cutoff_local;
  return cutoffsCrossed(start, next ?? now, tz, cutoff);
}

// When the card stops working: next departure + buffer, or a provisional window that
// grows in whole days while no flight is confirmed (so it does not change on every event).
export function activeUntil({ start, next, now, policy }) {
  const r = policy.rules;
  if (next != null) return next + hours(r.rebook_buffer_hours);
  const block = hours(r.provisional_hours);
  const blocks = Math.max(1, Math.ceil((now - start + hours(r.rebook_buffer_hours)) / block));
  return start + blocks * block;
}

// The card the rules want for this situation.
// `extras` and `extraCategories` are approved one-off raises (e.g. a hotel deposit).
export function planControls({ nights, city, policy, activeFrom, activeTo, extras = 0, extraCategories = [] }) {
  const c = policy.categories;
  const days = nights + 1;
  const breakdown = {
    meals: round2(city.meals_per_day * days),
    transport: round2(city.transport),
    lodging: round2(city.lodging_per_night * policy.rules.lodging_factor * nights),
    extras: round2(extras),
  };
  const base = ['meals', 'transport', ...(nights > 0 ? ['lodging'] : [])];
  const categories = Object.keys(c).filter((k) => base.includes(k) || extraCategories.includes(k));
  return {
    currency: city.currency,
    categories,
    mccs: categories.flatMap((k) => c[k].mccs),
    limit: round2(breakdown.meals + breakdown.transport + breakdown.lodging + breakdown.extras),
    breakdown,
    nights,
    activeFrom,
    activeTo,
  };
}

export function sameControls(a, b) {
  if (!a || !b) return false;
  return a.currency === b.currency && a.limit === b.limit && a.activeTo === b.activeTo &&
    a.mccs.length === b.mccs.length && a.mccs.every((m) => b.mccs.includes(m));
}

// Does moving from the current card to the planned one need the travel manager?
export function needsApproval(current, planned, approvedNights, policy) {
  const allowedNights = Math.max(approvedNights, policy.rules.auto_nights);
  if (planned.nights > allowedNights) {
    const n = policy.rules.auto_nights;
    return `Policy covers ${n} night${n === 1 ? '' : 's'} automatically; night ${planned.nights} needs approval`;
  }
  return null;
}

// A traveller's request for more money ("the hotel wants a 150 EUR deposit").
// Returns { result, why, raise?, category } where result is
// covered | raise | escalate | reject | no_card.
export function evaluateRequest({ card, spent, request, policy }) {
  const { category, amount } = request;
  if (!card || card.status !== 'ACTIVE') return { result: 'no_card', why: 'There is no active Detour card.' };
  if (!policy.categories[category]) {
    return { result: 'reject', why: `${category || 'That'} is not something Detour pays for (meals, taxis and hotels only).` };
  }
  if (!(amount > 0)) return { result: 'reject', why: 'No amount was given.' };
  if (request.currency && request.currency !== card.controls.currency) {
    return { result: 'reject', why: `This card pays in ${card.controls.currency}; ask the merchant to charge in ${card.controls.currency}.` };
  }

  const remaining = round2(card.controls.limit - spent);
  const allowedHere = card.controls.categories.includes(category);
  if (allowedHere && amount <= remaining) {
    return { result: 'covered', why: `The card already covers it: ${remaining} ${card.controls.currency} left.` };
  }

  const raise = round2(Math.max(0, amount - remaining));
  const cap = round2(card.controls.limit * policy.rules.max_auto_raise_pct / 100);
  if (!allowedHere) {
    return { result: 'escalate', raise, category, why: `${policy.categories[category].label} is not on the card yet and the flight feed does not show an overnight stay.` };
  }
  if (raise > cap) {
    return { result: 'escalate', raise, category, why: `A raise of ${raise} is more than ${policy.rules.max_auto_raise_pct}% of the current limit (${cap}).` };
  }
  return { result: 'raise', raise, category, why: `Raise of ${raise} is within policy.` };
}
