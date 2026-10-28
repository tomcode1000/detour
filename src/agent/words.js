// Plain-word templates. Used by the stand-in agent, and given to the model as the facts it
// must stick to. Numbers here always come from the rules, never from the model.

export function fmtMoney(amount, currency) {
  return `${Number(amount).toFixed(2).replace(/\.00$/, '')} ${currency}`;
}

export function fmtWhen(ms, tz) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
}

export function describeCard(card, policy, spent = 0) {
  if (!card) return 'No card.';
  const c = card.controls;
  const tz = c.tz || 'UTC';
  const cats = c.categories.map((k) => policy.categories[k].label.toLowerCase()).join(', ');
  const left = fmtMoney(Math.max(0, c.limit - spent), c.currency);
  return `${fmtMoney(c.limit, c.currency)} for ${cats}; ${left} left; works until ${fmtWhen(c.activeTo, tz)} ${c.city || ''} time`.trim();
}

export function describeNotice(notice, card, policy) {
  const facts = card ? describeCard(card, policy, notice.spent || 0) : '';
  switch (notice.type) {
    case 'issued':
      return `${notice.reason}. Detour has set up a card for you: ${facts}. It's in your wallet now - just tap to pay.`;
    case 'updated':
      return `Your card has been updated: ${notice.change}. Now ${facts}.`;
    case 'approval_requested':
      return `${notice.tell || notice.why}. I've asked ${policy.travel_manager} to approve it - I'll tell you as soon as they answer.`;
    case 'approved':
      return `${policy.travel_manager} approved it. ${facts}.`;
    case 'declined_by_manager':
      return `${policy.travel_manager} didn't approve the change. Your card stays as it is: ${facts}.`;
    case 'purchase_declined':
      return `A payment of ${fmtMoney(notice.amount, notice.currency)} at ${notice.merchant} was declined: ${notice.reasonText}.`;
    case 'expired':
      return `You're on your way. Your Detour card has been switched off.`;
    case 'closed':
      return `You've landed. Your Detour card is now closed. You spent ${fmtMoney(notice.spent, notice.currency)} on it - no receipts or expense claim needed.`;
    default:
      return notice.text || '';
  }
}

export function describeOutcome(outcome, card, policy) {
  const facts = card ? describeCard(card, policy, outcome.spent || 0) : '';
  switch (outcome.result) {
    case 'covered': return `Good news - ${outcome.why.charAt(0).toLowerCase()}${outcome.why.slice(1)} Go ahead and pay with the card.`;
    case 'raised': return `Done. I've raised your card by ${fmtMoney(outcome.raise, card.controls.currency)}. Now ${facts}.`;
    case 'escalate': return `${outcome.why} I've sent it to ${policy.travel_manager} for approval and will let you know.`;
    case 'pending': return `${policy.travel_manager} is already looking at it - I'll message you the moment they decide.`;
    case 'reject': return `Sorry - ${outcome.why}`;
    case 'no_card': return `You don't have a Detour card right now. If your flight is disrupted, one will appear automatically.`;
    default: return card ? `Your card: ${facts}.` : `Your flights look on track. If anything changes, I'll set up a card for you.`;
  }
}

export const DECLINE_WORDS = {
  MERCHANT_CATEGORY_NOT_ALLOWED: 'this card only works for meals, taxis and hotels',
  LIMIT_EXCEEDED: 'it is more than what is left on the card',
  OUT_OF_ALLOWED_TIME_RANGE: 'the card is outside its active time',
  CURRENCY_NOT_ALLOWED: 'the card only pays in the local currency',
  CARD_INACTIVE: 'the card has been switched off',
  CARD_CLOSED: 'the card is closed',
};
