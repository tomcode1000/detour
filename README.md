# Detour

Money that follows a stranded traveller. When a business traveller's flight is cancelled or badly delayed, Detour pays them a daily allowance for meals and taxis, at that city's rate, before they have to ask. Hotel nights go on a virtual Airwallex card that only hotels can charge, with a limit that always matches the nights approved. Later days and nights are scheduled rather than paid, and are dropped if the traveller gets home sooner, so money for days not stranded never leaves the company. As the disruption changes, the agent changes the payments, and anything over policy goes to the travel manager with the evidence attached. When the trip ends, Detour works out what the airline owes and writes the claim.

Built for the Airwallex Agentic Banking Hackathon (build period from 27 Oct 2026).

## Run it

Needs Node 20 or newer. There are no dependencies to install.

```
npm start          # http://localhost:4100
npm test           # rules, accounts, claims and full-story tests
```

| Address | What it is |
|---|---|
| `/` | Landing page (website) |
| `/security` | How Detour keeps money and data safe (website) |
| `/download` | Get the app: QR code, install button, Android and iPhone steps (website) |
| `/demo` | Both phones side by side. The judge sets up the trip by hand on the phones, then plays the story |
| `/app` | The installable phone app. First screen chooses the role and remembers it |
| `/manager` | Travel manager app: company sign-up, trips and invites, approvals, payments, hotel card, airline claim, policy, decision log |
| `/traveller` | Traveller app: sign in with the invited email, finish registering, route map, what's covered, money received, hotel card, messages, airline claim |

The phone app is a Progressive Web App (manifest, icons, service worker): on Android it installs from Chrome, on iPhone via Safari's Add to Home Screen. Installing from a phone needs the site online over HTTPS. With notifications turned on (More → Notifications), the app tells the person when something happens while it is in the background.

### The flow

1. The travel manager signs up the company (or opens the demo company) and adds a trip: the traveller's name, email and flights. Detour checks the airport codes, that no flight is in the past, and that connecting flights link up (each leaves from where the last one landed, after it). It does not yet check that a flight number really flies that day: a live version would ask a flight-status service (FlightAware, Cirium, AeroDataBox) and then follow the flights through it, in place of the scripted feed.
2. Detour makes an invite link and QR code. The manager can send it again (a fresh link) or remove the trip.
3. The traveller opens Detour with that email and checks the trip. If the flights are not theirs, they tap "This isn't my trip" and the manager is told. Otherwise they add a mobile number and the bank account for allowances (only the last four digits are kept), and sees the route on a map.
4. When a flight is disrupted, money moves on its own within policy. Anything over policy waits for the manager's approval.
5. When the trip ends, the hotel card closes, unused payments are cancelled, and the airline claim is ready. The manager marks it as sent, then settled.

Settings in `.env` (git-ignored):

| Variable | What it does |
|---|---|
| `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY` | Airwallex sandbox scoped key. The account must be registered in a region where Airwallex Issuing works (Singapore is used) |
| `FUNDING` | `hotel-card` (default): allowance by Airwallex transfer, hotel nights on an Airwallex hotels-only card. `hotel-card-local`: the same, simulated. `transfers` / `transfers-local`: transfers only, the hotel paid by transfer. `cards` / `cards-local`: everything on one card. The app always shows which one is running |
| `DEEPSEEK_API_KEY` | Turns on the DeepSeek agent. Without it, a keyword stand-in is used, and the app says so |
| `DEEPSEEK_MODEL` | Default `deepseek-flash` |

## How it is built

- `src/rules.js` sets every number: when a trip counts as disrupted, nights stranded (23:00 local cut-offs), limits, merchant codes, expiry, and when the travel manager must approve. The model can only propose.
- `src/engine.js` plays the trip's events (flight feed, airline emails, traveller messages, merchant charges) and keeps the money in line with the rules.
- `src/funding/` holds the money side. `transfers.js` turns the rules' plan into payments: an allowance to the traveller (converted into their home currency by Airwallex), later days scheduled and cancelled when not needed, and hotel nights on the hotel card (issued when the first night is needed, limit raised or lowered as nights are approved or dropped, closed when the trip ends). `transfer-backends.js` sends transfers through Airwallex beneficiaries and transfers. `airwallex.js` is Airwallex Issuing (cardholders, cards, authorization controls, simulated authorizations), and `local.js` simulates a card with the same controls and decline reasons.
- `src/claims.js` works out what the airline owes under EU261 or UK261: which law covers the journey (first departure to final arrival, and the airline's home region), the distance band, the delay, compensation for the traveller, and the meals, transport and hotel costs back to the company. It writes the claim letter.
- `src/accounts.js` holds the company, the travel manager (password stored as a scrypt hash), invites and registrations. They live in memory and reset with the demo.
- `src/agent/` holds the model side. The agent reads airline emails, understands the traveller and writes replies, using typed tools only. It never sees card numbers or keys.
- `scenarios/ada-frankfurt.json` is the scripted demo: a missed connection in Frankfurt, a rebooking, a second night that is approved and then not needed, and the trip home. The flight feed is scripted; a real deployment would use a paid flight-status API.
- `config/policy.json` holds the company policy and city rates. The rates are demo values.

## Airline messages

Airlines write to the traveller, not to Detour. Messages land in the traveller app, and Detour reads only what the traveller chooses to share: forwarded, pasted, a screenshot (read on the phone with OCR, so only the text is sent), or on Android via Share → Detour. A shared message is untrusted data: the agent can only report what it says (what happened, which flights, whether it asks for money or personal details), the flight status feed must agree, and the rules set every amount. The demo includes a scam "refund" message with an injected instruction; it changes nothing and Detour warns the traveller (see `test/sharing.test.js`).

## Status

Runs live on the Airwallex sandbox (Singapore account). Tested end to end on 1 to 3 Nov 2026: allowance transfers with EUR to SGD conversion, scheduled transfers cancelled, a hotels-only card issued, charged for night 1, raised for night 2, lowered when night 2 was not needed, a restaurant charge declined by the card's merchant rule, and the card closed at the end of the trip. Ada's trip ends with a UK261 claim: 520 GBP for her and 360 EUR back to the company.
