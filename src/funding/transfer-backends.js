// Where transfers actually go: the Airwallex sandbox, or a local simulation for tests.
import { createAirwallexClient, uuidFrom } from './airwallex-client.js';

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

// Airwallex Payouts: beneficiaries + transfers. Tested live in the sandbox on 28 Oct 2026
// (EUR->SGD with conversion, scheduled + cancelled, hotel as a company payee via SWIFT).
export function createAirwallexTransferBackend({ env, runKey }) {
  const call = createAirwallexClient(env);
  const payeeIds = new Map();

  async function payeeId(payee) {
    const nickname = `Detour - ${payee.name}`;
    if (payeeIds.has(nickname)) return payeeIds.get(nickname);
    const existing = await call('GET', '/api/v1/beneficiaries');
    const found = (existing.items || []).find((b) => b.nickname === nickname);
    let id = found && (found.beneficiary_id || found.id);
    if (!id) {
      const b = payee.bank;
      const created = await call('POST', '/api/v1/beneficiaries/create', {
        nickname,
        transfer_methods: [b.method],
        beneficiary: {
          entity_type: payee.entity_type,
          ...(payee.entity_type === 'COMPANY' ? { company_name: payee.name } : { first_name: payee.first_name, last_name: payee.last_name }),
          address: payee.address,
          bank_details: {
            account_currency: b.account_currency,
            account_name: payee.name,
            bank_country_code: b.bank_country_code,
            ...(b.iban && { iban: b.iban }),
            ...(b.account_number && { account_number: b.account_number }),
            ...(b.swift_code && { swift_code: b.swift_code }),
            ...(b.local_clearing_system && { local_clearing_system: b.local_clearing_system }),
          },
        },
      });
      id = created.beneficiary_id || created.id;
    }
    payeeIds.set(nickname, id);
    return id;
  }

  return {
    name: 'airwallex-transfers',
    label: 'Airwallex sandbox · transfers',

    async send({ attemptKey, payee, amount, currency, scheduleDays, reference }) {
      const toCurrency = payee.bank.account_currency;
      const body = {
        request_id: uuidFrom(`${runKey()}-${attemptKey}`),
        beneficiary_id: await payeeId(payee),
        source_currency: currency,
        transfer_currency: toCurrency,
        transfer_method: payee.bank.method,
        reason: 'travel',
        reference,
        ...(toCurrency === currency ? { transfer_amount: amount } : { source_amount: amount }),
        ...(scheduleDays > 0 && { transfer_date: isoDate(Date.now() + scheduleDays * 864e5) }),
      };
      const r = await call('POST', '/api/v1/transfers/create', body);
      return { id: r.id, received: { amount: r.transfer_amount, currency: r.transfer_currency }, fee: r.fee_amount ?? null };
    },

    // A transfer made seconds ago can refuse a cancel while Airwallex is still booking it
    // (the demo moves faster than real time), so check its status and try again briefly.
    async cancel(id) {
      for (let attempt = 0; ; attempt++) {
        try {
          await call('POST', `/api/v1/transfers/${id}/cancel`, {});
          return;
        } catch (e) {
          if (e.status !== 400) throw e;
          const t = await call('GET', `/api/v1/transfers/${id}`);
          if (t.status === 'CANCELLED') return;
          if (attempt >= 4) throw e;
          await new Promise((ok) => setTimeout(ok, 2000));
        }
      }
    },
  };
}

// LOCAL SIMULATION - not Airwallex. Fixed demo exchange rates, no fees.
const DEMO_RATES = { EUR: { EUR: 1, SGD: 1.4118, GBP: 0.86, USD: 1.08 } };

export function createLocalTransferBackend() {
  let n = 0;
  return {
    name: 'local-transfers',
    label: 'Local simulation · transfers (not Airwallex)',
    async send({ payee, amount, currency }) {
      const to = payee.bank.account_currency;
      const rate = DEMO_RATES[currency]?.[to] ?? 1;
      return { id: `local_tr_${++n}`, received: { amount: Math.round(amount * rate * 100) / 100, currency: to }, fee: 0 };
    },
    async cancel() {},
  };
}
