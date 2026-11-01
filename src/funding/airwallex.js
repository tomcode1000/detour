// Airwallex Issuing in the sandbox. Tested live on 1 Nov 2026 (Singapore sandbox account):
// issue, hotel-only MCC decline, limit raise, simulated charges, close.
// Never logs the API key, the token, or card numbers.
import { createAirwallexClient } from './airwallex-client.js';

// Scenario time and real time differ (the story happens on a fixed date and its clock jumps).
// Card windows are sent in real time: active from now, active for the same length as planned.
export function createAirwallexFunding({ env, clock }) {
  const call = createAirwallexClient(env);
  const cardholders = new Map();
  const lastTx = new Map(); // our label -> airwallex transaction id, for incremental auths

  const stamp = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, '+0000');
  const toReal = (scenarioMs) => Date.now() + (scenarioMs - clock());

  function toAuthorizationControls(c) {
    return {
      allowed_transaction_count: 'MULTIPLE',
      allowed_currencies: [c.currency],
      allowed_merchant_categories: c.mccs,
      transaction_limits: { currency: c.currency, limits: [{ amount: c.limit, interval: 'ALL_TIME' }] },
      active_from: stamp(Date.now() - 10 * 60e3), // a little early, so a charge right after issuing is inside the window
      active_to: stamp(toReal(c.activeTo)),
    };
  }

  // Airwallex allows one cardholder per email, so a traveller from an earlier run is reused.
  async function findCardholder(email) {
    for (let page = 0; page < 10; page++) {
      const r = await call('GET', `/api/v1/issuing/cardholders?page_num=${page}&page_size=100`);
      const found = (r.items || []).find((c) => c.email?.toLowerCase() === email.toLowerCase());
      if (found) return found.cardholder_id;
      if (!r.has_more) return null;
    }
    return null;
  }

  async function ensureCardholder(traveller) {
    if (cardholders.has(traveller.id)) return cardholders.get(traveller.id);
    const existing = await findCardholder(traveller.email);
    if (existing) { cardholders.set(traveller.id, existing); return existing; }
    const created = await call('POST', '/api/v1/issuing/cardholders/create', {
      type: 'INDIVIDUAL',
      email: traveller.email,
      individual: {
        name: { first_name: traveller.first_name, last_name: traveller.last_name },
        date_of_birth: traveller.date_of_birth,
        address: traveller.address,
        express_consent_obtained: 'yes',
      },
    });
    for (let i = 0; i < 15; i++) {
      const ch = await call('GET', `/api/v1/issuing/cardholders/${created.cardholder_id}`);
      if (ch.status === 'READY') break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    cardholders.set(traveller.id, created.cardholder_id);
    return created.cardholder_id;
  }

  const view = (card, controls) => ({
    id: card.card_id,
    status: card.card_status || 'ACTIVE',
    controls: { ...controls },
    last4: card.card_number ? String(card.card_number).slice(-4) : null,
  });

  return {
    kind: 'card',
    name: 'airwallex',
    label: 'Airwallex sandbox · card',

    async issue({ traveller, controls, requestId }) {
      const cardholderId = await ensureCardholder(traveller);
      const card = await call('POST', '/api/v1/issuing/cards/create', {
        request_id: requestId,
        cardholder_id: cardholderId,
        created_by: 'Detour agent',
        form_factor: 'VIRTUAL',
        is_personalized: true,
        program: { purpose: 'COMMERCIAL' },
        nick_name: `Detour ${traveller.first_name}`,
        authorization_controls: toAuthorizationControls(controls),
      });
      return view(card, controls);
    },

    async update(cardId, controls) {
      const card = await call('POST', `/api/v1/issuing/cards/${cardId}/update`, {
        authorization_controls: toAuthorizationControls(controls),
      });
      return view(card, controls);
    },

    async setStatus(cardId, status) {
      const card = await call('POST', `/api/v1/issuing/cards/${cardId}/update`, { card_status: status });
      return { id: cardId, status: card.card_status || status };
    },

    async authorize(cardId, { merchant, mcc, amount, currency, incrementOf, label }) {
      const body = {
        card_id: cardId,
        transaction_amount: amount,
        transaction_currency: currency,
        merchant_category_code: mcc,
        merchant_info: merchant,
      };
      if (incrementOf && lastTx.has(incrementOf)) body.transaction_id = lastTx.get(incrementOf);
      const at = clock();
      try {
        const r = await call('POST', '/api/v1/simulation/issuing/create', body);
        if (label && r.transaction_id) lastTx.set(label, r.transaction_id);
        // Builder guide: treat CLEARING as accepted and use failure_reason for a decline.
        const reason = r.failure_reason || (r.status === 'FAILED' ? 'DECLINED' : null);
        return { id: r.transaction_id, cardId, at, merchant, mcc, amount, currency, status: reason ? 'DECLINED' : 'APPROVED', reason, incrementOf: incrementOf || null };
      } catch (e) {
        // The docs say simulated auths that break the card's controls are rejected.
        return { id: null, cardId, at, merchant, mcc, amount, currency, status: 'DECLINED', reason: e.message, incrementOf: incrementOf || null };
      }
    },

    async transactions(cardId) {
      const r = await call('GET', `/api/v1/issuing/authorizations?card_id=${cardId}&page_size=100`);
      return (r.items || []).map((a) => ({
        id: a.transaction_id, cardId, merchant: a.merchant?.name, mcc: a.merchant?.category_code,
        amount: Math.abs(a.billing_amount ?? a.transaction_amount), currency: a.billing_currency ?? a.transaction_currency,
        status: a.status === 'FAILED' ? 'DECLINED' : 'APPROVED', reason: a.failure_reason || null,
      }));
    },
  };
}
