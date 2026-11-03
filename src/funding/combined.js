// Meals and taxis on the traveller's Detour card; the hotel paid directly to the hotel.
//  - The card's limit is the meals and taxis for the stay (and any approved extra), only at
//    restaurants and taxis, until the next flight leaves. It closes when the trip ends.
//  - Each hotel night is paid to the hotel by transfer, scheduled for check-in and cancelled
//    if the night is not needed, so the traveller has nothing to pay at the desk.
// `card` is the card funding (Airwallex or local); `hotel` is transfer funding limited to the hotel.

export function createCardAndHotelFunding({ card, hotel, label, name }) {
  const merge = (c, h) => ({ ...c, changes: h.changes });
  return {
    kind: 'card',
    variant: 'meal-card',
    hotelDirect: true,
    name,
    label,

    async issue(args) {
      const c = await card.issue(args);
      const h = await hotel.issue(args);
      return merge(c, h);
    },
    async update(id, controls) {
      const c = await card.update(id, controls);
      const h = await hotel.update(id, controls);
      return merge(c, h);
    },
    async setStatus(id, status) {
      const c = await card.setStatus(id, status);
      const h = await hotel.setStatus(id, status);
      return merge(c, h);
    },
    authorize: (id, ev) => card.authorize(id, ev),
    transactions: (id) => card.transactions(id),
    tick: () => hotel.tick(),
    ledger: () => hotel.ledger(),
    balances: card.balances,
  };
}
