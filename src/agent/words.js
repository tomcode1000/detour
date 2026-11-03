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
  const names = (rows) => {
    const n = rows.map((l) => l.what.toLowerCase());
    return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n.at(-1)}` : n[0];
  };
  const total = (rows) => fmtMoney(rows.reduce((s, l) => s + l.amount, 0), rows[0].currency);
  const sentToYou = created.filter((l) => l.role === 'traveller' && l.status === 'SENT');
  if (sentToYou.length) parts.push(`sent you ${total(sentToYou)}${received(sentToYou)} for ${names(sentToYou)}`);
  for (const l of created.filter((x) => x.role === 'traveller' && x.status === 'SCHEDULED')) {
    parts.push(`scheduled ${fmtMoney(l.amount, l.currency)} for ${l.what.toLowerCase()}, arriving ${fmtWhen(l.payAt, tz)}`);
  }
  for (const l of created.filter((x) => x.role === 'hotel')) {
    if (l.method === 'card') {
      parts.push(l.status === 'SENT'
        ? `paid ${l.payeeName} ${fmtMoney(l.amount, l.currency)} for ${l.what.toLowerCase()} on your Detour hotel card ending ${l.card} - nothing to pay at the desk`
        : l.status === 'DECLINED'
          ? `tried to pay ${l.payeeName} ${fmtMoney(l.amount, l.currency)} for ${l.what.toLowerCase()} on your hotel card, but it was declined - your travel manager has been told`
          : `will pay ${l.payeeName} ${fmtMoney(l.amount, l.currency)} for ${l.what.toLowerCase()} on your hotel card on ${fmtWhen(l.payAt, tz)}`);
      continue;
    }
    parts.push(l.status === 'SENT'
      ? `paid ${l.payeeName} ${fmtMoney(l.amount, l.currency)} directly for ${l.what.toLowerCase()} - just give your name at the desk`
      : `will pay ${l.payeeName} ${fmtMoney(l.amount, l.currency)} for ${l.what.toLowerCase()} on ${fmtWhen(l.payAt, tz)}`);
  }
  if (cancelled.length) parts.push(`cancelled the ${names(cancelled)} payments (${total(cancelled)}) because you won't need them`);
  return parts.join('; ');
}

// Reply to a shared airline message. Built only from the checked facts, never from the
// message's own wording, so a malicious message cannot put words in Detour's mouth.
const KIND_WORDS = { cancelled: 'is cancelled', delayed: 'is delayed', missed_connection: 'means a missed connection', rebooked: 'confirms a rebooking' };
function describeAirlineRead(n) {
  const flights = n.flights?.length ? n.flights.join(' and ') : 'your flight';
  if (n.suspicious) {
    return "I've read the message you shared. It asks for money or personal details, and it doesn't match your flight status, so I haven't changed anything. Please don't reply to it or send anything. Your company never asks you to pay through Detour.";
  }
  if (n.kind === 'other') return "Thanks, I've read it. It doesn't say anything about a delay or cancellation, so nothing changes. I'm still watching your flights.";
  if (n.agrees) return `Thanks, I've read it: it says ${flights} ${KIND_WORDS[n.kind]}. That matches the flight status, so you're covered as shown in the app.`;
  return `Thanks, I've read it: it says ${flights} ${KIND_WORDS[n.kind]}. The flight status doesn't show that yet, so nothing changes for now. I'll update you the moment it does.`;
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
      const c = notice.claim;
      const claim = c ? ` One more thing: under ${c.scheme}, ${c.airline} likely owes you ${fmtMoney(c.compensation, c.compCurrency)} for arriving this late${c.passOn ? `, which ${c.company}'s policy asks you to pass on to the company` : ''}. I've written the claim - it's in your Trips tab.` : '';
      return `You've landed. In total Detour sent you ${fmtMoney(s.toTraveller, s.currency)} and paid the hotel ${fmtMoney(s.toHotel, s.currency)}. No receipts to collect.${claim}`;
    }
    default: return notice.text || '';
  }
}

export function describeNotice(notice, card, policy) {
  if (notice.type === 'airline_read') return describeAirlineRead(notice);
  if (notice.mode === 'transfer') return describeTransferNotice(notice, policy);
  const facts = card ? describeCard(card, policy, notice.spent || 0) : '';
  const also = notice.payments ? ` Detour has also ${notice.payments}.` : '';
  const claimLine = (c) => (c ? ` One more thing: under ${c.scheme}, ${c.airline} likely owes you ${fmtMoney(c.compensation, c.compCurrency)} for arriving this late${c.passOn ? `, which ${c.company}'s policy asks you to pass on to the company` : ''}. I've written the claim - it's in your Trips tab.` : '');
  switch (notice.type) {
    case 'issued':
      return `${notice.reason}. Detour has set up your Detour card: ${facts}. It's in the Detour app.${also}`;
    case 'updated':
      return `${notice.prefix ? `${notice.prefix} ` : ''}Your card has been updated: ${notice.change}. Now ${facts}.${also}`;
    case 'approval_requested':
      return `${notice.tell || notice.why}. I've asked ${policy.travel_manager} to approve it - I'll tell you as soon as they answer.`;
    case 'approved':
      return `${policy.travel_manager} approved it. ${facts}.`;
    case 'declined_by_manager':
      return `${policy.travel_manager} didn't approve the change. Your card stays as it is: ${facts}.`;
    case 'purchase_declined':
      return `A payment of ${fmtMoney(notice.amount, notice.currency)} at ${notice.merchant} was declined: ${notice.reasonText}.`;
    case 'expired':
      return `You're on your way. Your Detour card has been switched off.${also}`;
    case 'closed':
      return `You've landed. Your Detour card is now closed. You spent ${fmtMoney(notice.spent, notice.currency)} on it${notice.toHotel ? ` and Detour paid the hotel ${fmtMoney(notice.toHotel, notice.currency)}` : ''} - no receipts or expense claim needed.${claimLine(notice.claim)}`;
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
    case 'covered_direct': return `Your hotel is already paid by your company - nothing to pay at the desk. If they still ask for a deposit, tell me the amount and I'll sort it.`;
    case 'escalate': return `${outcome.why} I've sent it to ${policy.travel_manager} for approval and will let you know.`;
    case 'pending': return `${policy.travel_manager} is already looking at it - I'll message you the moment they decide.`;
    case 'reject': return `Sorry - ${outcome.why}`;
    case 'no_card': return outcome.mode === 'transfer'
      ? `Detour isn't covering a disrupted trip for you right now. If a flight of yours is cancelled or badly delayed, I'll send you money automatically.`
      : `You don't have a Detour card right now. If your flight is disrupted, one will appear automatically.`;
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
