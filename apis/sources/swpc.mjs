// NOAA Space Weather Prediction Center — geomagnetic storm alerts + Kp index
// No auth, clean JSON, no documented rate limit. Ties into crucix's existing
// space/satellite tracking (apis/sources/space.mjs, CelesTrak) and an
// infrastructure-risk framing: geomagnetic storms threaten satellites, GPS,
// and power grids. The Kp index is a bounded 0-9 scale, same "fixed
// calm/crisis band is safe because it can't drift like a price" logic as
// the earthquake-magnitude risk component.

import { safeFetch } from '../utils/fetch.mjs';

const ALERTS_URL = 'https://services.swpc.noaa.gov/products/alerts.json';
const KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
const ALERT_WINDOW_HOURS = 24;

// Standard NOAA geomagnetic storm scale (G-scale) thresholds by Kp.
export function kpToGScale(kp) {
  if (kp == null) return null;
  if (kp >= 9) return 'G5';
  if (kp >= 8) return 'G4';
  if (kp >= 7) return 'G3';
  if (kp >= 6) return 'G2';
  if (kp >= 5) return 'G1';
  return null;
}

// SWPC timestamps are "YYYY-MM-DD HH:MM:SS.sss" with a space, no timezone
// (always UTC) — normalize to ISO 8601.
export function parseSwpcTimestamp(s) {
  if (!s) return null;
  const iso = `${s.replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : iso;
}

function compactAlert(a) {
  const issuedAt = parseSwpcTimestamp(a.issue_datetime);
  const messageCodeMatch = /Space Weather Message Code:\s*(\S+)/i.exec(a.message || '');
  const noticeMatch = /^(WARNING|ALERT|WATCH|EXTENDED WARNING|SUMMARY|CANCEL)/im.exec(a.message || '');
  return {
    productId: a.product_id,
    issuedAt,
    messageCode: messageCodeMatch ? messageCodeMatch[1] : null,
    noticeType: noticeMatch ? noticeMatch[1] : null,
    summary: (a.message || '').replace(/\s+/g, ' ').trim().slice(0, 200),
  };
}

async function fetchAlerts() {
  const result = await safeFetch(ALERTS_URL);
  if (result?.error) return { error: result.error };
  if (!Array.isArray(result)) return { error: 'Unexpected response shape from alerts.json' };

  const cutoff = Date.now() - ALERT_WINDOW_HOURS * 3600000;
  const alerts = result
    .map(compactAlert)
    .filter(a => a.issuedAt && Date.parse(a.issuedAt) >= cutoff)
    .slice(0, 20);

  return { alerts };
}

async function fetchKp() {
  const result = await safeFetch(KP_URL);
  if (result?.error) return { error: result.error };
  if (!Array.isArray(result) || result.length === 0) return { error: 'Unexpected response shape from k-index.json' };

  const latest = result[result.length - 1]; // oldest-first feed — last entry is most recent
  return {
    kp: latest.Kp ?? null,
    kpTime: latest.time_tag ? `${latest.time_tag}Z` : null,
    aRunning: latest.a_running ?? null,
  };
}

export async function briefing() {
  const [alertsResult, kpResult] = await Promise.all([fetchAlerts(), fetchKp()]);

  if (alertsResult.error && kpResult.error) {
    return { source: 'NOAA SWPC', error: `${alertsResult.error}; ${kpResult.error}` };
  }

  return {
    source: 'NOAA SWPC',
    timestamp: new Date().toISOString(),
    kp: kpResult.kp ?? null,
    kpTime: kpResult.kpTime ?? null,
    aRunning: kpResult.aRunning ?? null,
    gScale: kpToGScale(kpResult.kp),
    alertCount: alertsResult.alerts?.length || 0,
    alerts: alertsResult.alerts || [],
    ...(alertsResult.error ? { alertsError: alertsResult.error } : {}),
    ...(kpResult.error ? { kpError: kpResult.error } : {}),
  };
}

if (process.argv[1]?.endsWith('swpc.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
