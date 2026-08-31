// USGS Earthquake feed — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/usgs-earthquake.mjs';

function feature({ mag, place, time, tsunami = 0, alert = null, coords = [10, 20, 5] }) {
  return { properties: { mag, place, time, tsunami, alert, url: 'https://example.com' }, geometry: { coordinates: coords } };
}

describe('usgs-earthquake briefing', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('sorts by magnitude descending and summarizes tsunami/PAGER counts', async () => {
    const payload = {
      features: [
        feature({ mag: 4.6, place: 'A', time: 1000 }),
        feature({ mag: 6.8, place: 'B', time: 2000, tsunami: 1, alert: 'orange' }),
        feature({ mag: 5.1, place: 'C', time: 3000, alert: 'green' }),
      ],
    };
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(payload)) })
    );

    const result = await briefing();
    assert.equal(result.count, 3);
    assert.equal(result.maxMagnitude, 6.8);
    assert.equal(result.quakes[0].place, 'B');
    assert.equal(result.tsunamiWarnings, 1);
    assert.equal(result.pagerAlerts, 1); // only non-green alerts count
  });

  it('degrades gracefully on a fetch error', async () => {
    globalThis.fetch = mock.fn(() => Promise.reject(new Error('offline')));
    const result = await briefing();
    assert.ok(result.error);
  });
});
