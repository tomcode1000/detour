// Real flight status from AeroDataBox (through RapidAPI), for trips the travel manager adds.
// Ada's demo trip keeps its scripted feed, so the disruption happens on cue.
// Turned on by AERODATABOX_KEY. Never logs the key.
import { AIRPORTS } from '../claims.js';

const HOST = 'aerodatabox.p.rapidapi.com';
const CACHE_MS = 15 * 60e3; // the free plan has a small monthly allowance, so each flight is asked at most every 15 minutes

// "2026-11-15 10:30Z" or "2026-11-15 10:30+01:00" -> ms
const toMs = (t) => (t ? Date.parse(String(t).replace(' ', 'T')) : null);
const pick = (side) => toMs(side?.revisedTime?.utc || side?.runwayTime?.utc || side?.predictedTime?.utc) ?? toMs(side?.scheduledTime?.utc);

// The departure's local date, which is how flights are numbered.
export function localDate(ms, airport) {
  const tz = AIRPORTS[airport]?.[3] || 'UTC';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}

// AeroDataBox status words -> the ones Detour uses everywhere else.
const STATUS = { canceled: 'CANCELLED', canceleduncertain: 'CANCELLED', diverted: 'DIVERTED', departed: 'DEPARTED', enroute: 'DEPARTED', approaching: 'DEPARTED', arrived: 'LANDED', delayed: 'DELAYED' };

export function normalize(item, delayThresholdH = 2) {
  const sched_dep = toMs(item.departure?.scheduledTime?.utc);
  const est_dep = pick(item.departure);
  const sched_arr = toMs(item.arrival?.scheduledTime?.utc);
  const est_arr = pick(item.arrival);
  const delayMin = sched_dep && est_dep ? Math.round((est_dep - sched_dep) / 60e3) : 0;
  const arrDelayMin = sched_arr && est_arr ? Math.round((est_arr - sched_arr) / 60e3) : 0;
  let status = STATUS[String(item.status || '').toLowerCase()] || 'SCHEDULED';
  if (status === 'SCHEDULED' && delayMin >= 15) status = 'DELAYED';
  const disrupted = status === 'CANCELLED' || status === 'DIVERTED' || delayMin >= delayThresholdH * 60;
  return {
    status, delayMin, arrDelayMin, disrupted,
    from: item.departure?.airport?.iata || null, to: item.arrival?.airport?.iata || null,
    sched_dep, est_dep, sched_arr, est_arr,
    airline: item.airline?.name || null,
    checkedAt: Date.now(),
  };
}

export function createFlightStatus(env, { delayThresholdH = 2, fetchImpl = fetch } = {}) {
  const key = env.AERODATABOX_KEY;
  if (!key) return null;
  const cache = new Map();

  // One flight on one day, or null if the airline has no such flight that day.
  async function lookup(number, depMs, from) {
    const date = localDate(depMs, from);
    const id = `${number}/${date}/${from}`;
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const res = await fetchImpl(`https://${HOST}/flights/number/${encodeURIComponent(number)}/${date}?withAircraftImage=false&withLocation=false&dateLocalRole=Departure`, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': HOST },
      signal: AbortSignal.timeout(10e3),
    });
    if (res.status === 204 || res.status === 404) { cache.set(id, { at: Date.now(), value: null }); return null; }
    if (!res.ok) throw new Error(`Flight status service answered ${res.status}`);
    const items = await res.json().catch(() => []);
    const list = Array.isArray(items) ? items : [];
    const item = list.find((x) => x.departure?.airport?.iata === from) || null;
    const value = item ? normalize(item, delayThresholdH) : (list.length ? { wrongRoute: true, from: list[0].departure?.airport?.iata, to: list[0].arrival?.airport?.iata } : null);
    cache.set(id, { at: Date.now(), value });
    return value;
  }

  return { name: 'AeroDataBox', lookup };
}
