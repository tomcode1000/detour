import { createLocalFunding } from './local.js';
import { createAirwallexFunding } from './airwallex.js';
import { createTransferFunding } from './transfers.js';
import { createAirwallexTransferBackend, createLocalTransferBackend } from './transfer-backends.js';

// FUNDING picks how money reaches the traveller:
//   hotel-card       Airwallex: allowance to the traveller by transfer, hotel nights on a hotels-only card (default)
//   hotel-card-local the same, simulated locally
//   transfers        Airwallex transfers only: allowance to the traveller, hotel paid direct by transfer
//   transfers-local  the same, simulated locally
//   cards            Airwallex virtual card (needs card issuing enabled on the account)
//   cards-local      the card, simulated locally
export const FUNDING_MODES = ['hotel-card', 'hotel-card-local', 'transfers', 'transfers-local', 'cards', 'cards-local'];

export function createFunding({ env, clock, runKey, scenario, policy }) {
  const mode = env.FUNDING || 'hotel-card';
  if (mode === 'cards') return createAirwallexFunding({ env, clock });
  if (mode === 'cards-local') return createLocalFunding({ clock });

  const t = scenario.traveller;
  const payees = (role, controls) => {
    if (role === 'hotel') return policy.cities[controls.airport].hotel;
    return { name: `${t.first_name} ${t.last_name}`, entity_type: 'PERSONAL', first_name: t.first_name, last_name: t.last_name, address: t.bank_address, bank: t.bank };
  };
  const local = mode.endsWith('-local');
  const backend = local ? createLocalTransferBackend() : createAirwallexTransferBackend({ env, runKey });
  if (!mode.startsWith('hotel-card')) return createTransferFunding({ clock, backend, payees });
  const hotelCard = local ? createLocalFunding({ clock }) : createAirwallexFunding({ env, clock });
  const funding = createTransferFunding({ clock, backend, payees, hotelCard, traveller: t });
  return { ...funding, name: `${backend.name}+hotel-card`, label: local ? 'Local simulation · transfers + hotel card (not Airwallex)' : 'Airwallex sandbox · transfers + hotel card' };
}
