// Email through UnitPost (https://www.unitpost.com/docs/quickstart). Never logs the API key.
// Without UNITPOST_API_KEY and MAIL_FROM there is no mailer, and Detour only notifies in the app.
const URL = 'https://www.unitpost.com/api/v1/email';

export function createMailer(env) {
  if (!env.UNITPOST_API_KEY || !env.MAIL_FROM) return null;
  return {
    from: env.MAIL_FROM,
    // `key` makes a retry return the first result instead of sending the email twice.
    async send({ to, subject, html, key }) {
      const res = await fetch(URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.UNITPOST_API_KEY}`,
          'Content-Type': 'application/json',
          'User-Agent': 'detour/1.0',
          ...(key && { 'Idempotency-Key': key }),
        },
        body: JSON.stringify({ from: env.MAIL_FROM, to, subject, html }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
      if (!res.ok) throw new Error(`UnitPost ${res.status} ${data.error?.message || data.message || data.error || ''}`.trim());
      return { id: data.id || data.data?.id || null };
    },
  };
}
