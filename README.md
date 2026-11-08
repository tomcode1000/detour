# Detour

Detour is an AI agent that watches your flights and, the moment one is disrupted, pays for your meals, taxis and hotel on its own, inside your company's rules. It gives the traveller a virtual Airwallex card for restaurants and taxis, at that city's rate, and pays the hotel directly, so there is nothing to pay at the desk and no expense claim later. As the disruption changes, the agent changes the money: the card's limit follows the nights stranded, later hotel nights are scheduled and cancelled if the traveller gets home sooner, and anything over policy goes to the travel manager with the evidence attached. It reads the airline messages the traveller shares and refuses to act on one that doesn't match the flight status. When the trip ends it closes the card and writes the airline claim. Every payment comes from the company's own Airwallex balance, which the travel manager sees in the app.

Built for the Airwallex Agentic Banking Hackathon (build period from 27 Oct 2026).

## Live demo

**https://54-255-109-186.sslip.io**, running on the Airwallex sandbox.

- Start at `/demo` to see both phones side by side: set up the trip as the travel manager, accept it as the traveller, then play the disruption.
- Or open `/app` on two phones, one as the travel manager and one as the traveller.

## Run it

Needs Node 20 or newer. There are no dependencies to install.

```
git clone https://github.com/tomcode1000/detour.git
cd detour
npm start          # http://localhost:4100
npm test           # rules, accounts, claims and full-story tests
```

To use the live Airwallex sandbox, put your keys in a `.env` file at the root (see the settings table below). Without Airwallex keys, set `FUNDING=meal-card-local` to run the same flow on a labelled local simulation.

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

1. The travel manager signs up the company (or opens the demo company) and adds a trip: the traveller's name, email and flights. Detour checks the airport codes, that no flight is in the past, that flights are in time order, and that connections link up: flights less than a day apart must leave from where the last one landed, while a longer gap is a stay, so a return days later or a flight home from another city is fine. It does not yet check that a flight number really flies that day: a live version would ask a flight-status service (FlightAware, Cirium, AeroDataBox) and then follow the flights through it, in place of the scripted feed.
2. Detour makes an invite link and QR code. The manager can send it again (a fresh link) or remove the trip.
3. The traveller opens Detour with that email and checks the trip. If the flights are not theirs, they tap "This isn't my trip" and the manager is told. Otherwise they add a mobile number, then the date of birth and home address a card in their name needs (no bank account), and see the route on a map.
4. When a flight is disrupted, money moves on its own within policy. Anything over policy waits for the manager's approval.
5. When the trip ends, the card closes, unused hotel nights are cancelled, and the airline claim is ready. The manager marks it as sent, then settled. The company balance (More → Payments, or the panel on Home) is read live from Airwallex, with what is set aside for open trips and how to add funds.

Settings in `.env` (git-ignored):

| Variable | What it does |
|---|---|
| `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY` | Airwallex sandbox scoped key. The account must be registered in a region where Airwallex Issuing works (Singapore is used) |
| `FUNDING` | `meal-card` (default): meals and taxis on the traveller's Airwallex card, the hotel paid directly by Airwallex transfer. `meal-card-local`: the same, simulated. `hotel-card` / `hotel-card-local`: allowance by transfer, hotel nights on a hotels-only card. `transfers` / `transfers-local`: transfers only, the hotel paid by transfer. `cards` / `cards-local`: everything on one card. The app always shows which one is running |
| `DEEPSEEK_API_KEY` | Turns on the DeepSeek agent. Without it, a keyword stand-in is used, and the app says so |
| `DEEPSEEK_MODEL` | Default `deepseek-flash` |
| `UNITPOST_API_KEY`, `MAIL_FROM` | Turn on email through UnitPost, e.g. `MAIL_FROM=Detour <trips@your-domain.com>` (the domain must be verified in UnitPost). Without them, Detour notifies in the app only |
| `DEMO_INBOX` | Where emails to fictional demo addresses (`.example`) go. Without it they are skipped, so the sending domain never bounces |
| `PUBLIC_URL` | The address used in email links once deployed, e.g. `https://detour.example.org` |

## Deploy

The live demo runs on one small AWS Lightsail server (Ubuntu 24.04, Singapore region). Detour is a single Node process that keeps its state in memory and streams live updates to the phones (Server-Sent Events), so it needs one server that stays on, not serverless hosting. Caddy sits in front and gets the HTTPS certificate.

1. Create a Lightsail instance with **OS only → Ubuntu 24.04 LTS**, attach a static IP, and add an **HTTPS (443)** firewall rule.
2. Pick an address that points at the static IP: your own domain, or for free, `<ip-with-dashes>.sslip.io`.
3. In **Connect using SSH**:
   ```
   curl -fsSL https://raw.githubusercontent.com/tomcode1000/detour/master/deploy/lightsail-setup.sh -o setup.sh
   bash setup.sh your.address
   nano /opt/detour/.env            # paste the key values
   sudo systemctl restart detour
   ```
4. To ship a new version later: `bash /opt/detour/deploy/update.sh`

## How it is built

- `src/rules.js` sets every number: when a trip counts as disrupted, nights stranded (23:00 local cut-offs), limits, merchant codes, expiry, and when the travel manager must approve. The model can only propose.
- `src/engine.js` plays the trip's events (flight feed, airline emails, traveller messages, merchant charges) and keeps the money in line with the rules.
- `src/funding/` holds the money side. `transfers.js` turns the rules' plan into payments: an allowance to the traveller (converted into their home currency by Airwallex), later days scheduled and cancelled when not needed, and hotel nights on the hotel card (issued when the first night is needed, limit raised or lowered as nights are approved or dropped, closed when the trip ends). `transfer-backends.js` sends transfers through Airwallex beneficiaries and transfers. `airwallex.js` is Airwallex Issuing (cardholders, cards, authorization controls, simulated authorizations), and `local.js` simulates a card with the same controls and decline reasons.
- `src/claims.js` works out what the airline owes under EU261 or UK261: which law covers the journey (first departure to final arrival, and the airline's home region), the distance band, the delay, compensation for the traveller, and the meals, transport and hotel costs back to the company. It writes the claim letter.
- `src/accounts.js` holds the company, the travel manager (password stored as a scrypt hash), invites and registrations. They live in memory and reset with the demo.
- `src/agent/` holds the model side (DeepSeek). The agent reads the airline messages a traveller shares, understands what the traveller asks for and writes every message they get, using typed tools only. It proposes; `src/rules.js` decides every amount, and anything over policy goes to the travel manager. It never sees card numbers or keys.
- `src/notify/` sends the email copies of each moment (invite, card ready, hotel paid, decision needed, trip closed) through UnitPost.
- `scenarios/ada-frankfurt.json` is the scripted demo: a missed connection in Frankfurt, a rebooking, a second night that is approved and then not needed, and the trip home. The flight feed is scripted; a real deployment would use a paid flight-status API.
- `config/policy.json` holds the company policy and city rates. The rates are demo values.

## Airline messages

Airlines write to the traveller, not to Detour. Messages land in the traveller app, and Detour reads only what the traveller chooses to share: forwarded, pasted, a screenshot (read on the phone with OCR, so only the text is sent), or on Android via Share → Detour. A shared message is untrusted data: the agent can only report what it says (what happened, which flights, whether it asks for money or personal details), the flight status feed must agree, and the rules set every amount. The demo includes a scam "refund" message with an injected instruction; it changes nothing and Detour warns the traveller (see `test/sharing.test.js`).

## Status

Runs live on the Airwallex sandbox (Singapore account). Tested end to end on 3 Nov 2026 with the default `meal-card` mode: Ada's card issued for meals and taxis (EUR 120, raised to EUR 180 when she has to stay), a EUR 18.40 dinner approved, EUR 399 of headphones declined by the card's merchant rule, the hotel paid directly by transfer for night 1, night 2 scheduled after approval and cancelled when an earlier seat opened, the card closed when she landed, and a UK261 claim: 520 GBP for her and 198.40 EUR of care costs back to the company. The company balance is read live from Airwallex. The `hotel-card` and `transfers` modes were tested live on 1 Nov 2026.
