// Minimal Airwallex sandbox client shared by the card and transfer funding.
// Never logs the API key or the token.
import { createHash } from 'node:crypto';

export const BASE = 'https://api.sandbox.airwallex.com';

export function createAirwallexClient(env) {
  let token = null;
  let tokenAt = 0;

  async function login() {
    const res = await fetch(`${BASE}/api/v1/authentication/login`, {
      method: 'POST',
      headers: { 'x-client-id': env.AIRWALLEX_CLIENT_ID, 'x-api-key': env.AIRWALLEX_API_KEY },
    });
    if (!res.ok) throw new Error(`Airwallex login failed (HTTP ${res.status})`);
    token = (await res.json()).token;
    tokenAt = Date.now();
  }

  return async function call(method, path, body) {
    if (!token || Date.now() - tokenAt > 25 * 60e3) await login();
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
    if (!res.ok) {
      const err = new Error(`Airwallex ${method} ${path.split('?')[0]} -> ${res.status} ${data.code || ''} ${data.message || ''}`.trim());
      err.status = res.status;
      throw err;
    }
    return data;
  };
}

// A stable UUID from any string, so a retried request reuses its request_id.
export function uuidFrom(text) {
  const h = createHash('sha1').update(text).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
