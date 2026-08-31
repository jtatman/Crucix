// Elapsed-time fetch throttle for sources with a real-world cadence far
// slower than the 15-minute sweep loop (a once-daily report, a tight
// per-day API quota). Rather than gating on a specific hour of day —
// several sources this wraps (ISW) publish with no documented time and no
// machine-readable feed to check against — this gates on time elapsed
// since the last successful fetch, so it degrades gracefully regardless of
// when in the day a sweep happens to land: at most one real fetch per
// `minIntervalHours` window, every other sweep gets the cached result.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const STATE_DIR = join(process.cwd(), 'runs', 'daily-cache');

function statePath(key) {
  return join(STATE_DIR, `${key}.json`);
}

/**
 * @param {string} key - unique cache key (one state file per key)
 * @param {() => Promise<object>} fetchFn - performs the real fetch when due
 * @param {object} [opts]
 * @param {number} [opts.minIntervalHours=20] - minimum hours between real fetches
 */
export async function getOrFetchThrottled(key, fetchFn, opts = {}) {
  const { minIntervalHours = 20 } = opts;
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  const path = statePath(key);

  let state = null;
  try { state = JSON.parse(readFileSync(path, 'utf8')); } catch { /* first run for this key */ }

  const hoursSinceLastFetch = state ? (Date.now() - Date.parse(state.fetchedAt)) / 3600000 : Infinity;

  if (state && hoursSinceLastFetch < minIntervalHours) {
    return {
      ...state.data,
      cached: true,
      fetchedAt: state.fetchedAt,
      nextFetchInHours: parseFloat((minIntervalHours - hoursSinceLastFetch).toFixed(1)),
    };
  }

  try {
    const data = await fetchFn();
    const fetchedAt = new Date().toISOString();
    writeFileSync(path, JSON.stringify({ fetchedAt, data }));
    return { ...data, cached: false, fetchedAt };
  } catch (e) {
    // Fetch failed on a due check — fall back to the last good cache rather
    // than reporting a hard error for the rest of the throttle window.
    if (state?.data) {
      return { ...state.data, cached: true, stale: true, fetchedAt: state.fetchedAt, error: e.message };
    }
    return { error: e.message };
  }
}
