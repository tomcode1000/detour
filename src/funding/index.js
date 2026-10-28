import { createLocalFunding } from './local.js';
import { createAirwallexFunding } from './airwallex.js';
import { createTransferFunding } from './transfers.js';
import { createAirwallexTransferBackend, createLocalTransferBackend } from './transfer-backends.js';

// FUNDING picks how money reaches the traveller:
//   transfers        Airwallex transfers: daily allowance to the traveller, hotel paid direct (default)
//   transfers-local  the same, simulated locally
//   cards            Airwallex virtual card (needs card issuing enabled on the account)
//   cards-local      the card, simulated locally
export const FUNDING_MODES = ['transfers', 'transfers-local', 'cards', 'cards-local'];

export function createFunding({ env, clock, runKey, scenario, policy }) {
  const mode = env.FUNDING || 'transfers';
  if (mode === 'cards') return createAirwallexFunding({ env, clock });
  if (mode === 'cards-local') return createLocalFunding({ clock });

  const t = scenario.traveller;
  const payees = (role, controls) => {
    if (role === 'hotel') return policy.cities[controls.airport].hotel;
    return { name: `${t.first_name} ${t.last_name}`, entity_type: 'PERSONAL', first_name: t.first_name, last_name: t.last_name, address: t.bank_address, bank: t.bank };
  };
  const backend = mode === 'transfers-local' ? createLocalTransferBackend() : createAirwallexTransferBackend({ env, runKey });
  return createTransferFunding({ clock, backend, payees });
}
