// Elapsed-time fetch throttle — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getOrFetchThrottled } from '../apis/utils/daily-cache.mjs';

const STATE_DIR = join(process.cwd(), 'runs', 'daily-cache');
const testKey = 'test-throttle-key';
const statePath = join(STATE_DIR, `${testKey}.json`);

describe('getOrFetchThrottled', () => {
  after(() => { try { rmSync(statePath); } catch { /* already gone */ } });

  it('fetches for real on first call (no prior state)', async () => {
    let calls = 0;
    const result = await getOrFetchThrottled(testKey, async () => { calls++; return { value: 1 }; }, { minIntervalHours: 20 });
    assert.equal(calls, 1);
    assert.equal(result.value, 1);
    assert.equal(result.cached, false);
  });

  it('returns cached data on a second call within the throttle window', async () => {
    let calls = 0;
    const result = await getOrFetchThrottled(testKey, async () => { calls++; return { value: 2 }; }, { minIntervalHours: 20 });
    assert.equal(calls, 0);
    assert.equal(result.value, 1); // still the first call's cached value
    assert.equal(result.cached, true);
    assert.ok(result.nextFetchInHours > 0);
  });

  it('fetches again once the throttle window has elapsed', async () => {
    // Backdate the cached fetchedAt past the window
    mkdirSync(STATE_DIR, { recursive: true });
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.fetchedAt = new Date(Date.now() - 25 * 3600000).toISOString();
    writeFileSync(statePath, JSON.stringify(state));

    let calls = 0;
    const result = await getOrFetchThrottled(testKey, async () => { calls++; return { value: 3 }; }, { minIntervalHours: 20 });
    assert.equal(calls, 1);
    assert.equal(result.value, 3);
    assert.equal(result.cached, false);
  });

  it('falls back to last good cache when a due fetch throws', async () => {
    const result = await getOrFetchThrottled(testKey, async () => { throw new Error('boom'); }, { minIntervalHours: 0 });
    assert.equal(result.value, 3); // last successful value
    assert.equal(result.cached, true);
    assert.equal(result.stale, true);
    assert.match(result.error, /boom/);
  });

  it('reports a hard error when a fetch fails with no prior cache at all', async () => {
    const freshKey = 'test-throttle-key-fresh';
    const result = await getOrFetchThrottled(freshKey, async () => { throw new Error('no cache yet'); }, { minIntervalHours: 20 });
    assert.match(result.error, /no cache yet/);
    try { rmSync(join(STATE_DIR, `${freshKey}.json`)); } catch { /* may not have been written */ }
  });
});
