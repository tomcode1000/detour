# Detour

Money that follows a stranded traveller. When a business traveller's flight is cancelled or badly delayed, Detour pays them a daily allowance for meals and taxis, at that city's rate, before they have to ask. It pays the hotel directly, so that money can only go to the hotel. Later days and nights are scheduled rather than sent, and are cancelled if the traveller gets home sooner, so money for days not stranded never leaves the company. As the disruption changes, the agent changes the payments, and anything over policy goes to the travel manager with the evidence attached.

A virtual-card version (merchant-category limits, expiry) is built in too, ready for when the Airwallex account can issue cards.

Built for the Airwallex Agentic Banking Hackathon (build period from 27 Oct 2026).

## Run it

Needs Node 20 or newer. There are no dependencies to install.

```
npm start          # http://localhost:4100
npm test           # rules + full-story tests
```

Settings in `.env` (git-ignored):

| Variable | What it does |
|---|---|
| `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY` | Airwallex sandbox scoped key |
| `FUNDING` | `transfers` (default): real Airwallex transfers. `transfers-local`: the same, simulated. `cards`: Airwallex virtual card (needs card issuing on the account). `cards-local`: the card, simulated. The page always shows which one is running. |
| `DEEPSEEK_API_KEY` | Turns on the DeepSeek agent. Without it, a keyword stand-in is used, and the page says so. |
| `DEEPSEEK_MODEL` | Default `deepseek-flash` |

## How it is built

- `src/rules.js` sets every number: when a trip counts as disrupted, nights stranded (23:00 local cut-offs), limit, merchant codes, expiry, and when the travel manager must approve. The model can only propose.
- `src/engine.js` plays the trip's events (flight feed, airline emails, traveller messages, merchant charges) and keeps the card in line with the rules.
- `src/funding/` holds the money side. `transfers.js` turns the rules' plan into payments: an allowance to the traveller (converted into their home currency by Airwallex), the hotel paid directly, later days scheduled and cancelled when not needed. `transfer-backends.js` sends them through Airwallex beneficiaries and transfers. `airwallex.js` is the card version (Issuing: cards, authorization controls, simulated authorizations), and `local.js` simulates the card.
- `src/agent/` holds the model side. The agent reads airline emails, understands the traveller and writes replies, using typed tools only. It never sees card numbers or keys.
- `scenarios/ada-frankfurt.json` is the scripted demo: a missed connection in Frankfurt, a rebooking, a second night and the trip home. The flight feed is scripted; a real deployment would use a paid flight-status API.
- `config/policy.json` holds the company policy and city rates. The rates are demo values.

## Status

Transfers run live on the Airwallex sandbox (tested 28 Oct 2026: EUR to SGD conversion, hotel paid via SWIFT, scheduled payments cancelled). The account cannot issue cards yet ("Invalid issuance details"), and Airwallex support has been asked to fix it. `sandbox_check.mjs` is the pre-build check for cards.
