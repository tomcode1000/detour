# Detour

Money that follows a stranded traveller. When a business traveller's flight is cancelled or badly delayed, Detour gives them a virtual card in the local currency. The card works only for meals, taxis and hotels, holds that city's rate, and stops working when they fly. As the disruption changes, the agent changes the card, and anything over policy goes to the travel manager with the evidence attached.

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
| `FUNDING=airwallex` | Use real Airwallex Issuing. Without it, a local simulation of the same card controls is used, and the page says so. |
| `DEEPSEEK_API_KEY` | Turns on the DeepSeek agent. Without it, a keyword stand-in is used, and the page says so. |
| `DEEPSEEK_MODEL` | Default `deepseek-flash` |

## How it is built

- `src/rules.js` sets every number: when a trip counts as disrupted, nights stranded (23:00 local cut-offs), limit, merchant codes, expiry, and when the travel manager must approve. The model can only propose.
- `src/engine.js` plays the trip's events (flight feed, airline emails, traveller messages, merchant charges) and keeps the card in line with the rules.
- `src/funding/` holds the money side. `airwallex.js` uses Airwallex Issuing (cards, authorization controls, simulated authorizations). `local.js` is a stand-in that applies the same controls and decline reasons.
- `src/agent/` holds the model side. The agent reads airline emails, understands the traveller and writes replies, using typed tools only. It never sees card numbers or keys.
- `scenarios/ada-frankfurt.json` is the scripted demo: a missed connection in Frankfurt, a rebooking, a second night and the trip home. The flight feed is scripted; a real deployment would use a paid flight-status API.
- `config/policy.json` holds the company policy and city rates. The rates are demo values.

## Status

The Airwallex sandbox account cannot issue cards yet ("Invalid issuance details"). Airwallex support has been asked to fix it. Until then the demo runs on the local simulation, and the page labels it clearly. `sandbox_check.mjs` is the pre-build check that tests the account.
