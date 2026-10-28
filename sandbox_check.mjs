// Detour sandbox check: runs BRIEF.txt section 3 "NOT YET CONFIRMED" tests a-d.
// Usage: node sandbox_check.mjs   (reads ./.env, never prints the keys or token)
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const BASE = "https://api.sandbox.airwallex.com";
const env = Object.fromEntries(
  readFileSync(new URL("./.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const SECRET_KEYS = /token|card_number|cvv|pan|api_key|client_id/i;
const scrub = (v) =>
  Array.isArray(v) ? v.map(scrub)
  : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEYS.test(k) ? "[redacted]" : scrub(x)]))
    : v;
const nonZero = (b) => (Array.isArray(b) ? b.filter((x) => x.total_amount || x.pending_amount || x.reserved_amount) : b);
const show = (label, v) => console.log(`\n--- ${label}\n${JSON.stringify(scrub(v), null, 2)}`);

let token;
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function login() {
  const res = await fetch(BASE + "/api/v1/authentication/login", {
    method: "POST",
    headers: { "x-client-id": env.AIRWALLEX_CLIENT_ID, "x-api-key": env.AIRWALLEX_API_KEY },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`login ${res.status} ${JSON.stringify(scrub(data))}`);
  token = data.token;
  console.log("login ok");
}

const results = {};
const iso = (ms) => new Date(Date.now() + ms).toISOString().replace(/\.\d+Z$/, "+0000");

async function simulate(cardId, mcc, amount, label) {
  const r = await api("POST", "/api/v1/simulation/issuing/create", {
    card_id: cardId,
    transaction_amount: amount,
    transaction_currency: "EUR",
    merchant_category_code: mcc,
    merchant_info: `${label} Frankfurt DE`,
  });
  show(`simulate ${label} MCC ${mcc} ${amount} EUR -> HTTP ${r.status}`, r.data);
  return r;
}

async function authsFor(cardId) {
  const r = await api("GET", `/api/v1/issuing/authorizations?card_id=${cardId}&page_size=50`);
  show(`authorizations for card -> HTTP ${r.status}`, r.data);
  return r;
}

async function main() {
  await login();

  // 0. Balance; fund with deposit simulation if empty
  let bal = await api("GET", "/api/v1/balances/current");
  show(`balances (non-zero) -> HTTP ${bal.status}`, nonZero(bal.data));
  const total = Array.isArray(bal.data) ? bal.data.reduce((s, b) => s + (b.available_amount || 0), 0) : 0;
  if (total === 0) {
    const dep = await api("POST", "/api/v1/simulation/deposit/create", { amount: 5000, currency: "USD" });
    show(`deposit simulation 5000 USD -> HTTP ${dep.status}`, dep.data);
    bal = await api("GET", "/api/v1/balances/current");
    show(`balances after deposit -> HTTP ${bal.status}`, nonZero(bal.data));
  }

  // a. cardholder + EUR virtual card with MCC allowlist
  const ch = await api("POST", "/api/v1/issuing/cardholders/create", {
    type: "INDIVIDUAL",
    email: `ada.${Date.now()}@example.com`,
    individual: {
      name: { first_name: "Ada", last_name: "Traveller" },
      date_of_birth: "1990-01-01",
      address: { line1: "1 Raffles Place", city: "Singapore", state: "SG", postcode: "048616", country: "SG" },
      express_consent_obtained: "yes",
    },
  });
  show(`create cardholder -> HTTP ${ch.status}`, ch.data);
  const cardholderId = ch.data.cardholder_id;
  if (!cardholderId) throw new Error("cardholder create failed");
  for (let i = 0; i < 15; i++) {
    const s = await api("GET", `/api/v1/issuing/cardholders/${cardholderId}`);
    if (s.data.status === "READY") break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  const createCard = (controls, label) =>
    api("POST", "/api/v1/issuing/cards/create", {
      request_id: randomUUID(),
      cardholder_id: cardholderId,
      created_by: "Detour agent",
      form_factor: "VIRTUAL",
      is_personalized: true,
      program: { purpose: "COMMERCIAL" },
      authorization_controls: {
        allowed_transaction_count: "MULTIPLE",
        allowed_currencies: ["EUR"],
        allowed_merchant_categories: ["5812", "4121"],
        transaction_limits: { currency: "EUR", limits: [{ amount: 500, interval: "ALL_TIME" }] },
        ...controls,
      },
    }).then((r) => (show(`create card (${label}) -> HTTP ${r.status}`, r.data), r));

  const card = await createCard({}, "EUR, MCC 5812/4121");
  const cardId = card.data.card_id;
  if (!cardId) throw new Error("card create failed");
  results.a = `card ${card.data.card_status ?? ""} created`;

  // b. allowed vs disallowed MCC
  results.b_5812 = await simulate(cardId, "5812", 18, "Restaurant");
  results.b_5732 = await simulate(cardId, "5732", 40, "Electronics");
  results.b_limit = await simulate(cardId, "5812", 600, "OverLimit");

  // c. auth outside active window: card active from tomorrow
  const future = await createCard(
    { active_from: iso(24 * 3600e3), active_to: iso(48 * 3600e3) }, "active_from tomorrow");
  if (future.data.card_id) results.c = await simulate(future.data.card_id, "5812", 18, "Restaurant-before-window");

  // d. EUR auth against a USD-only wallet: see balances after
  await authsFor(cardId);
  if (future.data.card_id) await authsFor(future.data.card_id);
  const after = await api("GET", "/api/v1/balances/current");
  show(`balances after auths (non-zero) -> HTTP ${after.status}`, nonZero(after.data));

  console.log("\n=== SUMMARY (HTTP status of each simulate call)");
  for (const [k, v] of Object.entries(results)) console.log(k, typeof v === "string" ? v : v.status);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
