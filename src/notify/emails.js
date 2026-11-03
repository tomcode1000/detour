// The emails Detour sends, and when. Each one mirrors a moment the app already shows:
//  invite (manager adds a trip), card ready, hotel paid, decision needed (to the manager),
//  trip resolved with the airline claim. The app stays the main place; email is the copy that
//  reaches people when the app is closed.
// Fictional addresses (.example, .test) cannot receive mail. They go to DEMO_INBOX when it is set,
// otherwise they are skipped, so the new sending domain never bounces.
import { fmtMoney } from '../agent/words.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fictional = (addr) => /\.(example|test|invalid|localhost)$/i.test(String(addr).trim());

// One plain, inbox-safe layout: a dark header with the wordmark, a white body, one button.
function layout({ title, intro, rows = [], button, foot }) {
  const rowsHtml = rows.map(([k, v]) => `<tr><td style="padding:8px 0;color:#5b6b7a;font-size:14px">${esc(k)}</td><td style="padding:8px 0;text-align:right;font-weight:600;font-size:14px;color:#0b1620">${esc(v)}</td></tr>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#eef2f6;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#0b1620">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#04111b;padding:18px 24px;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-.01em">&#9654;&nbsp;Detour</td></tr>
<tr><td style="padding:26px 24px 8px"><h1 style="margin:0 0 10px;font-size:21px;line-height:1.25">${esc(title)}</h1><p style="margin:0;font-size:15px;line-height:1.55;color:#33414e">${esc(intro)}</p></td></tr>
${rows.length ? `<tr><td style="padding:10px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e3e9ef;border-bottom:1px solid #e3e9ef">${rowsHtml}</table></td></tr>` : ''}
${button ? `<tr><td style="padding:22px 24px 6px"><a href="${esc(button.href)}" style="display:inline-block;background:#04111b;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px">${esc(button.label)}</a></td></tr>` : ''}
<tr><td style="padding:22px 24px 24px;color:#7a8794;font-size:12.5px;line-height:1.5">${esc(foot || 'Detour pays for meals, taxis and hotels when a flight is disrupted, inside your company\'s travel policy.')}</td></tr>
</table></td></tr></table></body></html>`;
}

export function createEmails({ mailer, env, engine, accounts, baseUrl }) {
  if (!mailer) return { invite: async () => null, onChange: () => {} };
  let skippedNoted = false;
  const note = (text) => engine.record('agent', text);

  async function deliver({ to, name, subject, html, key }) {
    let addr = to;
    if (fictional(to)) {
      if (!env.DEMO_INBOX) {
        if (!skippedNoted) { note(`Email not sent to ${to}: it is a fictional address. Set DEMO_INBOX in .env to receive the demo emails.`); skippedNoted = true; }
        return null;
      }
      addr = env.DEMO_INBOX;
    }
    try {
      const r = await mailer.send({ to: addr, subject, html, key });
      note(`Emailed ${name}: "${subject}"${addr !== to ? ' (to the demo inbox)' : ''}.`);
      return r;
    } catch (e) {
      note(`Email to ${name} failed: ${e.message}`);
      return null;
    }
  }

  const company = () => accounts.company.name;
  const traveller = () => accounts.invites.find((i) => i.live);
  const run = () => engine.runKey;

  // The manager added a trip: the traveller gets the link to open it.
  async function invite(inv) {
    const link = `${baseUrl()}/traveller?invite=${inv.token}`;
    const route = [inv.flights[0]?.from, ...inv.flights.map((f) => f.to)].join(' → ');
    return deliver({
      to: inv.email, name: inv.name, key: `invite-${inv.token}`,
      subject: `${company()} set up Detour for your trip`,
      html: layout({
        title: `Hi ${inv.name.split(' ')[0]}, you're covered`,
        intro: `${accounts.company.manager} at ${company()} has added your trip to Detour. If a flight is cancelled or badly delayed, Detour pays for your meals, taxis and hotel. Open the link on your phone to check the trip and finish registering.`,
        rows: [['Trip', route], ['Flights', inv.flights.map((f) => f.id).join(' · ')]],
        button: { label: 'Open my trip', href: link },
        foot: `If these aren't your flights, tap "This isn't my trip" in Detour and ${accounts.company.manager} will be told. The link works for 14 days.`,
      }),
    });
  }

  // Changes in the story, compared with the last state: the same moments the apps show.
  function onChange(a, b) {
    const t = traveller();
    if (!t || !a) return;
    const tName = t.name;
    const app = `${baseUrl()}/traveller`;
    const city = b.card?.controls.city || b.disruption && b.policy.cities[b.disruption.airport]?.city;

    if (b.card && !a.card && b.mode === 'card') {
      const c = b.card;
      deliver({
        to: t.email, name: tName, key: `${run()}-card`,
        subject: `Your Detour card is ready for ${city}`,
        html: layout({
          title: 'Your Detour card is ready',
          intro: `Your flight was disrupted, so ${company()} has given you a Detour card for meals and taxis in ${city}. It's in the Detour app. Anything else is declined.`,
          rows: [['Card', `•••• ${c.last4 || '----'}`], ['To spend', fmtMoney(c.controls.limit, c.controls.currency)], ['Works for', 'Restaurants and taxis']],
          button: { label: 'Open Detour', href: app },
        }),
      });
    }

    const was = new Set((a.payments || []).filter((l) => l.status === 'SENT').map((l) => l.key));
    const hotel = (b.payments || []).filter((l) => l.role === 'hotel' && l.status === 'SENT' && !was.has(l.key));
    if (hotel.length) {
      const h = hotel[0];
      deliver({
        to: t.email, name: tName, key: `${run()}-${hotel.map((l) => l.key).join('-')}`,
        subject: `Your hotel is paid: ${h.payeeName.replace(/\s+GmbH$/, '')}`,
        html: layout({
          title: 'Your hotel is paid',
          intro: `${company()} has paid your hotel directly. Just give your name at the desk. There's nothing to pay and nothing to claim later.`,
          rows: [['Hotel', h.payeeName.replace(/\s+GmbH$/, '')], ...hotel.map((l) => [l.what, fmtMoney(l.amount, l.currency)])],
          button: { label: 'See your trip', href: app },
        }),
      });
    }

    for (const ap of b.approvals || []) {
      if (ap.status !== 'PENDING' || (a.approvals || []).some((x) => x.id === ap.id)) continue;
      deliver({
        to: accounts.company.email, name: accounts.company.manager, key: `${run()}-${ap.id}`,
        subject: `Decision needed: ${ap.kind === 'nights' ? `night ${ap.to.nights}` : 'extra cover'} for ${tName.split(' ')[0]}`,
        html: layout({
          title: `${tName.split(' ')[0]} needs your decision`,
          intro: `${ap.why}. Detour has attached the flight status and the airline message. Approve or decline in the Detour app.`,
          rows: [['Traveller', tName], ['Request', ap.kind === 'nights' ? `Night ${ap.to.nights} in ${ap.to.city}` : `Extra cover in ${ap.to.city}`], ['Extra', fmtMoney(ap.delta, ap.to.currency)]],
          button: { label: 'Review the request', href: `${baseUrl()}/manager?tab=approvals` },
        }),
      });
    }

    if (b.summary && !a.summary) {
      const s = b.summary;
      const c = b.claim?.eligible ? b.claim : null;
      deliver({
        to: t.email, name: tName, key: `${run()}-closed`,
        subject: c ? `Trip resolved, and ${c.airline} likely owes you ${fmtMoney(c.compensation.amount, c.compensation.currency)}` : 'Your trip is resolved',
        html: layout({
          title: 'Trip resolved',
          intro: `You're on your way. Your Detour card is closed, and there are no receipts to keep.${c ? ` Under ${c.scheme}, ${c.airline} likely owes you compensation for arriving ${c.delayText} late${c.compensation.passOn ? `; ${company()}'s policy asks you to pass it on to the company when it arrives` : ''}. Detour has written the claim letter: it's in the Trips tab.` : ''}`,
          rows: [
            ...(s.mode === 'transfer' ? [['Sent to you', fmtMoney(s.toTraveller, s.currency)]] : [['Spent on your card', fmtMoney(s.spent, s.currency)]]),
            ...(s.toHotel ? [['Hotel, paid directly', fmtMoney(s.toHotel, s.currency)]] : []),
            ...(c ? [[c.compensation.passOn ? 'Compensation (passed to the company)' : 'Compensation, yours', fmtMoney(c.compensation.amount, c.compensation.currency)]] : []),
          ],
          button: c ? { label: 'See the claim', href: app } : { label: 'Open Detour', href: app },
        }),
      });
      // The manager files the claim: the care costs come back to the company.
      deliver({
        to: accounts.company.email, name: accounts.company.manager, key: `${run()}-closed-manager`,
        subject: c ? `Trip closed: ${fmtMoney(c.care.total, c.care.currency)} to reclaim from ${c.airline}` : `Trip closed: ${tName}`,
        html: layout({
          title: `${tName.split(' ')[0]}'s trip is closed`,
          intro: `${tName} is on the way. The Detour card is closed and unused hotel nights were cancelled before they were paid.${c ? ` Detour has written the claim to ${c.airline} in ${tName.split(' ')[0]}'s name: send it, then mark it as sent in Detour.` : ''}`,
          rows: [
            ...(s.mode === 'transfer' ? [['Sent to the traveller', fmtMoney(s.toTraveller, s.currency)]] : [['Spent on the card', fmtMoney(s.spent, s.currency)]]),
            ...(s.toHotel ? [['Paid to the hotel', fmtMoney(s.toHotel, s.currency)]] : []),
            ...(c ? [['Care costs back to the company', fmtMoney(c.care.total, c.care.currency)], [c.compensation.passOn ? `Compensation, passed on by ${tName.split(' ')[0]}` : `Compensation, ${tName.split(' ')[0]}'s by law`, fmtMoney(c.compensation.amount, c.compensation.currency)]] : []),
          ],
          button: c ? { label: 'Send the claim', href: `${baseUrl()}/manager?tab=claim` } : { label: 'Open Detour', href: `${baseUrl()}/manager` },
          foot: c ? 'The care costs (meals, taxis, hotel) are owed even if the airline cites extraordinary circumstances. Compensation is set by law and paid to the passenger.' : undefined,
        }),
      });
    }
  }

  return { invite, onChange };
}
