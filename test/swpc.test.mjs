// NOAA SWPC — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { briefing, kpToGScale, parseSwpcTimestamp } from '../apis/sources/swpc.mjs';

function mockFetchFor({ alerts, kp }) {
  return mock.fn((url) => {
    if (url.includes('alerts.json')) {
      return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(alerts)) });
    }
    return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(kp)) });
  });
}

describe('kpToGScale', () => {
  it('maps Kp thresholds to the standard G-scale', () => {
    assert.equal(kpToGScale(3), null);
    assert.equal(kpToGScale(5), 'G1');
    assert.equal(kpToGScale(6), 'G2');
    assert.equal(kpToGScale(7), 'G3');
    assert.equal(kpToGScale(8), 'G4');
    assert.equal(kpToGScale(9), 'G5');
    assert.equal(kpToGScale(null), null);
  });
});

describe('parseSwpcTimestamp', () => {
  it('converts the space-separated SWPC timestamp to ISO 8601', () => {
    assert.equal(parseSwpcTimestamp('2026-08-31 11:47:00.727'), '2026-08-31T11:47:00.727Z');
  });

  it('returns null for empty input', () => {
    assert.equal(parseSwpcTimestamp(''), null);
    assert.equal(parseSwpcTimestamp(undefined), null);
  });
});

describe('swpc briefing', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('reports the latest Kp value (last element of an oldest-first feed) and its G-scale', async () => {
    const kp = [
      { time_tag: '2026-08-31T00:00:00', Kp: 2, a_running: 5, station_count: 8 },
      { time_tag: '2026-08-31T03:00:00', Kp: 7.33, a_running: 40, station_count: 8 },
    ];
    globalThis.fetch = mockFetchFor({ alerts: [], kp });
    const result = await briefing();
    assert.equal(result.kp, 7.33);
    assert.equal(result.gScale, 'G3');
  });

  it('filters alerts to the last 24 hours only', async () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 2 * 3600000).toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);
    const old = new Date(now.getTime() - 31 * 24 * 3600000).toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);
    const alerts = [
      { product_id: 'RECENT', issue_datetime: recent, message: 'Space Weather Message Code: ALTEF3\nALERT: recent one' },
      { product_id: 'OLD', issue_datetime: old, message: 'Space Weather Message Code: WARK04\nWARNING: old one' },
    ];
    globalThis.fetch = mockFetchFor({ alerts, kp: [{ time_tag: '2026-08-31T00:00:00', Kp: 1, a_running: 3, station_count: 8 }] });

    const result = await briefing();
    assert.equal(result.alertCount, 1);
    assert.equal(result.alerts[0].productId, 'RECENT');
    assert.equal(result.alerts[0].noticeType, 'ALERT');
  });

  it('returns partial data with a soft error when only one feed fails', async () => {
    globalThis.fetch = mock.fn((url) => {
      if (url.includes('alerts.json')) return Promise.reject(new Error('alerts down'));
      return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify([{ time_tag: '2026-08-31T00:00:00', Kp: 1, a_running: 3, station_count: 8 }])) });
    });
    const result = await briefing();
    assert.equal(result.error, undefined);
    assert.equal(result.kp, 1);
    assert.ok(result.alertsError);
  });

  it('reports a hard error only when both feeds fail', async () => {
    globalThis.fetch = mock.fn(() => Promise.reject(new Error('all down')));
    const result = await briefing();
    assert.ok(result.error);
  });
});
