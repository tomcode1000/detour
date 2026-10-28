// Time-zone helpers built on Intl, so "23:00 in Frankfurt" means what it says.
const HOUR = 3600e3;
const DAY = 24 * HOUR;
const formatters = new Map();

function formatter(tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }));
  }
  return formatters.get(tz);
}

export function localParts(ms, tz) {
  const out = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out; // { year, month, day, hour, minute }
}

// Milliseconds the zone is ahead of UTC at a given instant.
function offsetAt(ms, tz) {
  const p = localParts(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / 60000) * 60000;
}

export function localToUtc(year, month, day, hour, minute, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  return guess - offsetAt(guess - offsetAt(guess, tz), tz);
}

// How many local cut-off times (e.g. 23:00) fall inside [startMs, endMs]: the nights stranded.
export function cutoffsCrossed(startMs, endMs, tz, cutoff = '23:00') {
  if (endMs < startMs) return 0;
  const [h, m] = cutoff.split(':').map(Number);
  const p = localParts(startMs, tz);
  let day = Date.UTC(p.year, p.month - 1, p.day);
  let count = 0;
  for (let i = 0; i < 60; i++) {
    const d = new Date(day);
    const t = localToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, m, tz);
    if (t > endMs) break;
    if (t >= startMs) count++;
    day += DAY;
  }
  return count;
}

export const hours = (n) => n * HOUR;
export const parseTime = (iso) => (typeof iso === 'number' ? iso : Date.parse(iso));
