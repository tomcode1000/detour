// What the airline owes after a disruption, under EU 261/2004 or its UK copy (UK261).
//  - Compensation (Art. 7) belongs to the passenger: a fixed sum by distance, owed when the
//    journey arrives 3 hours or more late, unless the airline proves extraordinary circumstances.
//  - Care (Art. 9: meals, hotel, transport to the hotel) is owed whatever the cause. The company
//    paid it through Detour, so that refund goes back to the company.
// A journey with a connection is judged as one journey: first departure to final arrival.
import { fmtMoney } from './agent/words.js';

// [lat, lon, region, time zone]. Region EU covers the EU plus Iceland, Norway and Switzerland.
export const AIRPORTS = {
  SIN: [1.364, 103.991, 'OTHER', 'Asia/Singapore'], FRA: [50.038, 8.562, 'EU', 'Europe/Berlin'], LHR: [51.47, -0.454, 'UK', 'Europe/London'],
  LGW: [51.153, -0.182, 'UK', 'Europe/London'], CDG: [49.01, 2.548, 'EU', 'Europe/Paris'], AMS: [52.31, 4.768, 'EU', 'Europe/Amsterdam'],
  MUC: [48.354, 11.786, 'EU', 'Europe/Berlin'], ZRH: [47.465, 8.549, 'EU', 'Europe/Zurich'], MAD: [40.472, -3.561, 'EU', 'Europe/Madrid'],
  LIS: [38.774, -9.134, 'EU', 'Europe/Lisbon'], IST: [41.262, 28.742, 'OTHER', 'Europe/Istanbul'], DXB: [25.253, 55.365, 'OTHER', 'Asia/Dubai'],
  DOH: [25.273, 51.608, 'OTHER', 'Asia/Qatar'], HKG: [22.308, 113.918, 'OTHER', 'Asia/Hong_Kong'], NRT: [35.772, 140.393, 'OTHER', 'Asia/Tokyo'],
  HND: [35.549, 139.78, 'OTHER', 'Asia/Tokyo'], ICN: [37.46, 126.441, 'OTHER', 'Asia/Seoul'], BKK: [13.69, 100.75, 'OTHER', 'Asia/Bangkok'],
  KUL: [2.746, 101.71, 'OTHER', 'Asia/Kuala_Lumpur'], SYD: [-33.94, 151.175, 'OTHER', 'Australia/Sydney'], JFK: [40.641, -73.778, 'OTHER', 'America/New_York'],
  EWR: [40.69, -74.174, 'OTHER', 'America/New_York'], BOS: [42.366, -71.01, 'OTHER', 'America/New_York'], ORD: [41.974, -87.907, 'OTHER', 'America/Chicago'],
  SFO: [37.621, -122.379, 'OTHER', 'America/Los_Angeles'], LAX: [33.942, -118.408, 'OTHER', 'America/Los_Angeles'], YYZ: [43.678, -79.625, 'OTHER', 'America/Toronto'],
  LOS: [6.577, 3.321, 'OTHER', 'Africa/Lagos'], NBO: [-1.319, 36.928, 'OTHER', 'Africa/Nairobi'], JNB: [-26.139, 28.246, 'OTHER', 'Africa/Johannesburg'],
};

const SCHEMES = {
  EU261: { law: 'Regulation (EC) No 261/2004', currency: 'EUR', bands: [250, 400, 600] },
  UK261: { law: 'Regulation (EC) No 261/2004 as retained in UK law (UK261)', currency: 'GBP', bands: [220, 350, 520] },
};

export function distanceKm(a, b) {
  const [lat1, lon1] = AIRPORTS[a]; const [lat2, lon2] = AIRPORTS[b];
  const rad = Math.PI / 180;
  const h = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
}

// Which law covers the journey (Art. 3), from where it starts and ends and who flies it.
export function schemeFor(from, to, carrierRegion) {
  const start = AIRPORTS[from]?.[2]; const end = AIRPORTS[to]?.[2];
  if (start === 'EU') return 'EU261';
  if (start === 'UK') return 'UK261';
  if (end === 'EU' && carrierRegion === 'EU') return 'EU261';
  if (end === 'UK' && (carrierRegion === 'UK' || carrierRegion === 'EU')) return 'UK261';
  return null;
}

// Art. 7: the band by distance; halved when the delay is under the band's threshold (2/3/4 h).
export function compensationFor(scheme, km, delayMins, intraEu = false) {
  const { bands, currency } = SCHEMES[scheme];
  if (delayMins < 180) return { amount: 0, currency, band: null };
  const band = km <= 1500 ? 0 : km <= 3500 || intraEu ? 1 : 2;
  const halfUnder = [120, 180, 240][band];
  return { amount: delayMins < halfUnder ? bands[band] / 2 : bands[band], currency, band };
}

const when = (ms, code) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: AIRPORTS[code]?.[3] || 'UTC', timeZoneName: 'short' }).format(ms);
const hours = (mins) => `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
const round2 = (n) => Math.round(n * 100) / 100;

// booked: the flights on the ticket; flown: the flights actually taken (both in order).
// care: what Detour paid for meals, transport and the hotel ([{ what, amount, currency }]).
// compensationTo: 'traveller' (the law: it is the passenger's) or 'company' (company policy asks the
// traveller to pass it on). Either way the airline pays the passenger; the letter does not change.
export function claimFor({ airline, traveller, company, booked, flown, care, compensationTo = 'traveller' }) {
  const from = booked[0].from; const to = booked.at(-1).to;
  const scheme = schemeFor(from, to, airline.region);
  const scheduledArr = booked.at(-1).sched_arr;
  const actualArr = flown.at(-1).est_arr;
  const delayMins = Math.max(0, Math.round((actualArr - scheduledArr) / 60e3));
  const km = AIRPORTS[from] && AIRPORTS[to] ? distanceKm(from, to) : null;
  const careTotal = round2(care.reduce((s, c) => s + c.amount, 0));
  const careCurrency = care[0]?.currency || null;
  const base = { airline: airline.name, claimsEmail: airline.claims_email || null, from, to, km, scheduledArr, actualArr, delayMins, delayText: hours(delayMins), booked: booked.map((f) => f.id), flown: flown.map((f) => f.id) };
  if (!scheme) return { ...base, scheme: null, eligible: false, reason: 'Neither EU261 nor UK261 covers this journey, so the airline owes nothing by law.' };

  const intraEu = AIRPORTS[from][2] === AIRPORTS[to][2] && AIRPORTS[from][2] !== 'OTHER';
  const comp = compensationFor(scheme, km, delayMins, intraEu);
  const law = SCHEMES[scheme].law;
  const claim = {
    ...base, scheme, law, eligible: comp.amount > 0 || careTotal > 0,
    compensation: { ...comp, owedTo: traveller, passOn: compensationTo === 'company', why: comp.amount ? `${km.toLocaleString('en-GB')} km journey arriving ${hours(delayMins)} late` : 'arrived less than 3 hours late' },
    care: { items: care, total: careTotal, currency: careCurrency, owedTo: company },
    caveats: [
      'Compensation is not owed if the airline shows the disruption was caused by extraordinary circumstances (for example severe weather or air traffic control). Meals, hotel and transport are owed either way.',
      'Airlines never charge a fee to pay compensation. A message asking for one is a scam.',
    ],
  };
  claim.letter = letter(claim, { airline, traveller, company, booked, flown });
  return claim;
}

function letter(c, { airline, traveller, company, booked, flown }) {
  const lines = [
    `To: ${airline.name} customer relations${c.claimsEmail ? ` <${c.claimsEmail}>` : ''}`,
    `Subject: ${c.scheme} claim - ${traveller} - ${c.booked.join(' / ')}`,
    '',
    'Dear Customer Relations,',
    '',
    `I am writing about my journey from ${c.from} to ${c.to} on ${c.booked.join(' and ')}, booked as one journey.`,
    `It was due to arrive at ${when(c.scheduledArr, c.to)}. After a missed connection${flown.length !== booked.length || flown.some((f, i) => f.id !== booked[i]?.id) ? ` and rebooking onto ${c.flown.filter((id) => !c.booked.includes(id)).join(', ')}` : ''}, I arrived at ${when(c.actualArr, c.to)}, ${c.delayText} late.`,
    '',
  ];
  if (c.compensation.amount) {
    lines.push(`Under ${c.law}, Article 7, I claim compensation of ${fmtMoney(c.compensation.amount, c.compensation.currency)} for a ${c.km.toLocaleString('en-GB')} km journey arriving more than ${c.delayMins >= 240 ? 'four' : 'three'} hours late.`);
  }
  if (c.care.total) {
    lines.push(`Under Article 9, I also claim reimbursement of ${fmtMoney(c.care.total, c.care.currency)} for meals, transport and a hotel I had to arrange myself while I waited:`);
    for (const i of c.care.items) lines.push(`  - ${i.what}: ${fmtMoney(i.amount, i.currency)}`);
    lines.push(`These costs were paid by my employer, ${company}. Please refund them to ${company}.`);
  }
  lines.push('', 'Please reply within 14 days. Payment records for each amount above are attached.', '', 'Kind regards,', traveller);
  return lines.join('\n');
}
