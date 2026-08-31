// Open-Meteo — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { briefing, LOCATIONS } from '../apis/sources/open-meteo.mjs';

function forecast(lat, lon, current) {
  return { latitude: lat, longitude: lon, current: { time: '2026-08-31T12:00', ...current } };
}

describe('open-meteo briefing', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('flags severity via weather code, wind gusts, and precipitation independently', async () => {
    const payload = LOCATIONS.map((loc, i) => {
      if (i === 0) return forecast(loc.lat, loc.lon, { weather_code: 95, wind_gusts_10m: 10, precipitation: 0 }); // storm code
      if (i === 1) return forecast(loc.lat, loc.lon, { weather_code: 1, wind_gusts_10m: 75, precipitation: 0 }); // gusts
      if (i === 2) return forecast(loc.lat, loc.lon, { weather_code: 1, wind_gusts_10m: 10, precipitation: 15 }); // precip
      return forecast(loc.lat, loc.lon, { weather_code: 1, wind_gusts_10m: 10, precipitation: 0 }); // calm
    });
    globalThis.fetch = mock.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(payload)) }));

    const result = await briefing();
    assert.equal(result.locationsMonitored, LOCATIONS.length);
    assert.equal(result.severeCount, 3);
    assert.equal(result.locations[0].severe, true);
    assert.equal(result.locations[1].severe, true);
    assert.equal(result.locations[2].severe, true);
    assert.equal(result.locations[3].severe, false);
  });

  it('handles a shorter-than-expected upstream response defensively', async () => {
    const payload = [forecast(1, 1, { weather_code: 0, wind_gusts_10m: 0, precipitation: 0 })];
    globalThis.fetch = mock.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(payload)) }));
    const result = await briefing();
    assert.equal(result.locationsMonitored, 1);
  });

  it('degrades gracefully on a fetch error', async () => {
    globalThis.fetch = mock.fn(() => Promise.reject(new Error('offline')));
    const result = await briefing();
    assert.ok(result.error);
  });

  it('degrades gracefully on an unexpected response shape', async () => {
    globalThis.fetch = mock.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ not: 'an array' })) }));
    const result = await briefing();
    assert.ok(result.error);
  });
});
