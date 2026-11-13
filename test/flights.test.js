import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlightStatus, normalize, localDate } from '../src/flights/aerodatabox.js';

const item = (over = {}) => ({
  number: 'BA 117', status: 'Expected', airline: { name: 'British Airways' },
  departure: { airport: { iata: 'LHR' }, scheduledTime: { utc: '2026-11-20 10:30Z' }, ...over.departure },
  arrival: { airport: { iata: 'JFK' }, scheduledTime: { utc: '2026-11-20 18:40Z' } },
  ...over.top,
});

test('no key, no flight status service', () => {
  assert.equal(createFlightStatus({}), null);
});

test('a flight on time, late, cancelled', () => {
  assert.deepEqual([normalize(item()).status, normalize(item()).disrupted], ['SCHEDULED', false]);
  const late = normalize(item({ departure: { revisedTime: { utc: '2026-11-20 13:05Z' } } }));
  assert.equal(late.delayMin, 155);
  assert.equal(late.status, 'DELAYED');
  assert.equal(late.disrupted, true); // over the 2 hour threshold
  const bit = normalize(item({ departure: { revisedTime: { utc: '2026-11-20 11:00Z' } } }));
  assert.equal(bit.disrupted, false);
  assert.equal(normalize(item({ top: { status: 'Canceled' } })).status, 'CANCELLED');
  assert.equal(normalize(item({ top: { status: 'Canceled' } })).disrupted, true);
});

test('looks up the local departure date, matches the airport, caches', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    assert.equal(opts.headers['X-RapidAPI-Host'], 'aerodatabox.p.rapidapi.com');
    if (url.includes('XX1')) return { status: 204, ok: true, json: async () => [] };
    return { status: 200, ok: true, json: async () => [item()] };
  };
  const fs = createFlightStatus({ AERODATABOX_KEY: 'k' }, { fetchImpl });
  const dep = Date.parse('2026-11-20T10:30:00Z');
  assert.equal(localDate(Date.parse('2026-11-20T23:30:00Z'), 'SIN'), '2026-11-21');
  const s = await fs.lookup('BA117', dep, 'LHR');
  assert.equal(s.from, 'LHR');
  assert.match(calls[0], /\/flights\/number\/BA117\/2026-11-20\?/);
  await fs.lookup('BA117', dep, 'LHR');
  assert.equal(calls.length, 1); // cached
  assert.equal(await fs.lookup('XX1', dep, 'LHR'), null);
  assert.equal((await fs.lookup('BA117', dep, 'FRA')).wrongRoute, true);
});
