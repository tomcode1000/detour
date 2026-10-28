// LOCAL SIMULATION - not Airwallex. Used only while the sandbox cannot issue cards.
// It enforces the same authorization controls Airwallex documents, with the same
// decline reasons, so the rest of Detour behaves the same when the real card is plugged in.

export function createLocalFunding({ clock }) {
  const cards = new Map();
  const byRequestId = new Map();
  const transactions = [];
  let n = 0;

  const approvedTotal = (cardId) => transactions
    .filter((t) => t.cardId === cardId && t.status === 'APPROVED')
    .reduce((s, t) => s + t.amount, 0);

  return {
    kind: 'card',
    name: 'local',
    label: 'Local simulation · card (not Airwallex)',

    async issue({ controls, requestId }) {
      if (byRequestId.has(requestId)) return { ...cards.get(byRequestId.get(requestId)) };
      const card = { id: `local_card_${++n}`, status: 'ACTIVE', controls: { ...controls }, last4: String(4000 + n * 821).slice(-4) };
      cards.set(card.id, card);
      byRequestId.set(requestId, card.id);
      return { ...card };
    },

    async update(cardId, controls) {
      const card = cards.get(cardId);
      card.controls = { ...controls };
      return { ...card };
    },

    async setStatus(cardId, status) {
      cards.get(cardId).status = status;
      return { ...cards.get(cardId) };
    },

    // A merchant asks to charge the card. Mirrors Airwallex's order of checks.
    async authorize(cardId, { merchant, mcc, amount, currency, incrementOf }) {
      const card = cards.get(cardId);
      const c = card.controls;
      const now = clock();
      let reason = null;
      if (card.status === 'CLOSED') reason = 'CARD_CLOSED';
      else if (card.status !== 'ACTIVE') reason = 'CARD_INACTIVE';
      else if (now < c.activeFrom || now > c.activeTo) reason = 'OUT_OF_ALLOWED_TIME_RANGE';
      else if (currency !== c.currency) reason = 'CURRENCY_NOT_ALLOWED';
      else if (!c.mccs.includes(mcc)) reason = 'MERCHANT_CATEGORY_NOT_ALLOWED';
      else if (approvedTotal(cardId) + amount > c.limit + 1e-9) reason = 'LIMIT_EXCEEDED';
      const tx = {
        id: `local_tx_${transactions.length + 1}`, cardId, at: now, merchant, mcc, amount, currency,
        status: reason ? 'DECLINED' : 'APPROVED', reason, incrementOf: incrementOf || null,
      };
      transactions.push(tx);
      return { ...tx };
    },

    async transactions(cardId) {
      return transactions.filter((t) => t.cardId === cardId).map((t) => ({ ...t }));
    },
  };
}
