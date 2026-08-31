// Ukraine Air Raid Alerts (siren.pp.ua) — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { briefing, ageMinutes } from '../apis/sources/ukraine-alerts.mjs';

describe('ageMinutes', () => {
  it('computes minutes since a recent timestamp', () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60000).toISOString();
    assert.ok(Math.abs(ageMinutes(tenMinAgo) - 10) < 1);
  });

  it('returns Infinity for an unparseable timestamp', () => {
    assert.equal(ageMinutes('not-a-date'), Infinity);
  });
});

describe('ukraine-alerts briefing', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('splits recent AIR alerts from stale/other alert types', async () => {
    const fresh = new Date(Date.now() - 5 * 60000).toISOString();
    const stale = new Date(Date.now() - 5 * 24 * 60 * 60000).toISOString(); // 5 days old
    const payload = [
      { regionId: '1', regionEngName: 'Test Oblast', activeAlerts: [{ type: 'AIR', lastUpdate: fresh }] },
      { regionId: '2', regionEngName: 'Occupied Region', activeAlerts: [{ type: 'AIR', lastUpdate: stale }, { type: 'ARTILLERY', lastUpdate: stale }] },
    ];
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(payload)) })
    );

    const result = await briefing();
    assert.equal(result.activeAirAlertCount, 1);
    assert.equal(result.activeAirAlerts[0].region, 'Test Oblast');
    assert.equal(result.typeCounts.AIR, 2);
    assert.equal(result.typeCounts.ARTILLERY, 1);
    assert.ok(result.staleOrOtherAlerts.some(a => a.region === 'Occupied Region' && a.type === 'AIR'));
  });

  it('degrades gracefully on a network error', async () => {
    globalThis.fetch = mock.fn(() => Promise.reject(new Error('network down')));
    const result = await briefing();
    assert.ok(result.error);
  });

  it('degrades gracefully on an unexpected response shape', async () => {
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ not: 'an array' })) })
    );
    const result = await briefing();
    assert.ok(result.error);
  });
});
