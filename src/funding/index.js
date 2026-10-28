import { createLocalFunding } from './local.js';
import { createAirwallexFunding } from './airwallex.js';

// FUNDING=airwallex uses the real sandbox; anything else uses the local simulation.
export function createFunding({ env, clock }) {
  if (env.FUNDING === 'airwallex') return createAirwallexFunding({ env, clock });
  return createLocalFunding({ clock });
}
