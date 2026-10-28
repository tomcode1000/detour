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

// What the transfer funding did, e.g. "sent you 120 EUR (169.42 SGD) for meals, day 1 and
// taxis; will pay Airport Hotel 180 EUR for hotel, night 2 on Fri 20:00".
export function describePayments({ created = [], cancelled = [] }, tz) {
  const parts = [];
  const received = (rows) => {
    const r = rows.filter((l) => l.received && l.received.currency !== l.currency);
    if (!r.length) return '';
    const total = r.reduce((s, l) => s + l.received.amount, 0);
    return ` (${fmtMoney(total, r[0].received.currency)} in your account)`;
  };
  const names = (rows) => rows.map((l) => l.what.toLowerCase()).join(', ');
  const total = (rows) => fmtMoney(rows.reduce((s, l) => s + l.amount, 0), rows[0].currency);
  const sentToYou = created.filter((l) => l.role === 'traveller' && l.status === 'SENT');
  if (sentToYou.length) parts.push(`sent you ${total(sentToYou)}${received(sentToYou)} for ${names(sentToYou)}`);
  for (const l of created.filter((x) => x.role === 'traveller' && x.status === 'SCHEDULED')) {
    parts.push(`scheduled ${fmtMoney(l.amount, l.currency)} for ${l.what.toLowerCase()}, arriving ${fmtWhen(l.payAt, tz)}`);
  }
  for (const l of created.filter((x) => x.role === 'hotel')) {
    parts.push(l.status === 'SENT'
      ? `paid ${l.payeeName} ${fmtMoney(l.amount, l.currency)} directly for ${l.what.toLowerCase()} - just give your name at the desk`
      : `will pay ${l.payeeName} ${fmtMoney(l.amount, l.currency)} for ${l.what.toLowerCase()} on ${fmtWhen(l.payAt, tz)}`);
  }
  if (cancelled.length) parts.push(`cancelled ${total(cancelled)} that is no longer needed (${names(cancelled)}) - it never leaves the company account`);
  return parts.join('; ');
}

function describeTransferNotice(notice, policy) {
  const did = notice.payments ? `Detour has ${notice.payments}.` : '';
  switch (notice.type) {
    case 'issued': return `${notice.reason}. ${did} No card or receipts needed.`;
    case 'updated': return notice.prefix ? `${notice.prefix} ${did}` : `Update: ${did}`;
    case 'approval_requested': return `${notice.tell || notice.why}. I've asked ${policy.travel_manager} to approve it - I'll tell you as soon as they answer.`;
    case 'declined_by_manager': return `${policy.travel_manager} didn't approve it, so nothing extra has been sent.`;
    case 'expired': return `You're on your way. ${did}`.trim();
    case 'closed': {
      const s = notice.summary;
      return `You've landed. In total Detour sent you ${fmtMoney(s.toTraveller, s.currency)} and paid the hotel ${fmtMoney(s.toHotel, s.currency)} directly. Nothing to claim, no receipts.`;
    }
    default: return notice.text || '';
  }
}

export function describeNotice(notice, card, policy) {
  if (notice.mode === 'transfer') return describeTransferNotice(notice, policy);
  const facts = card ? describeCard(card, policy, notice.spent || 0) : '';
  switch (notice.type) {
    case 'issued':
      return `${notice.reason}. Detour has set up a card for you: ${facts}. It's in your wallet now - just tap to pay.`;
    case 'updated':
      return `${notice.prefix ? `${notice.prefix} ` : ''}Your card has been updated: ${notice.change}. Now ${facts}.`;
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
    case 'raised': return outcome.mode === 'transfer'
      ? `Done. I've sent you ${fmtMoney(outcome.raise, card.controls.currency)} extra - it's within policy.`
      : `Done. I've raised your card by ${fmtMoney(outcome.raise, card.controls.currency)}. Now ${facts}.`;
    case 'covered_direct': return `Your hotel is already paid directly by your company - just give your name at the desk. If they still ask for a deposit, tell me the amount and I'll sort it.`;
    case 'escalate': return `${outcome.why} I've sent it to ${policy.travel_manager} for approval and will let you know.`;
    case 'pending': return `${policy.travel_manager} is already looking at it - I'll message you the moment they decide.`;
    case 'reject': return `Sorry - ${outcome.why}`;
    case 'no_card': return `You don't have a Detour card right now. If your flight is disrupted, one will appear automatically.`;
    default:
      if (!card) return `Your flights look on track. If anything changes, I'll make sure you're covered.`;
      return outcome.mode === 'transfer' ? `You're covered for ${card.controls.categories.map((k) => policy.categories[k].label.toLowerCase()).join(', ')} until ${fmtWhen(card.controls.activeTo, card.controls.tz)}.` : `Your card: ${facts}.`;
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
