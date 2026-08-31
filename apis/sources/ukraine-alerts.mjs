// Ukraine Air Raid Alerts — siren.pp.ua (public wrapper for the official
// Ukraine Alarm / alerts.in.ua siren network, api.ukrainealarm.com)
// No auth required. Verified live 2026-08-31: returns real-time siren state
// with sub-hour freshness across ~40 tracked regions/communities.
//
// Why this exists: it's a genuinely machine-generated, real-time (minutes,
// not hours) signal — the siren network itself, not anyone's Telegram
// framing of an event. Complements (does not replace) the Telegram OSINT
// feed: a fresh AIR alert here is exactly the kind of independent
// corroboration that keyword-matched "urgent" Telegram posts currently lack.
//
// NOTE: this endpoint mixes genuinely transient alerts (AIR — sirens that
// get cleared) with alert types that some front-line/occupied regions carry
// indefinitely because Ukraine cannot verify an all-clear there (ARTILLERY,
// URBAN_FIGHTS can show multi-year-old lastUpdate timestamps). Only AIR
// alerts updated within RECENCY_WINDOW_MIN are treated as "currently active"
// here — the other types are reported but not counted toward that total.
//
// The official alerts.in.ua API also exists but requires emailing
// api@alerts.in.ua for a token (not instant self-serve) — this wrapper is
// used instead specifically because it's actually free and keyless today.

import { safeFetch } from '../utils/fetch.mjs';

const URL = 'https://siren.pp.ua/api/v3/alerts';
const RECENCY_WINDOW_MIN = 60;

export function ageMinutes(isoString) {
  const t = Date.parse(isoString);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 60000;
}

export async function briefing() {
  const result = await safeFetch(URL);
  if (result?.error) {
    return { source: 'Ukraine Air Raid Alerts', error: result.error, hint: 'siren.pp.ua may be temporarily down' };
  }
  if (!Array.isArray(result)) {
    return { source: 'Ukraine Air Raid Alerts', error: 'Unexpected response shape', hint: 'siren.pp.ua API may have changed' };
  }

  const typeCounts = {};
  const activeAir = [];
  const otherAlerts = [];

  for (const region of result) {
    const name = region.regionEngName || region.regionName || `region:${region.regionId}`;
    for (const alert of (region.activeAlerts || [])) {
      typeCounts[alert.type] = (typeCounts[alert.type] || 0) + 1;
      const age = ageMinutes(alert.lastUpdate);
      if (alert.type === 'AIR' && age <= RECENCY_WINDOW_MIN) {
        activeAir.push({ region: name, lastUpdate: alert.lastUpdate, ageMinutes: Math.round(age) });
      } else {
        otherAlerts.push({ region: name, type: alert.type, lastUpdate: alert.lastUpdate, ageMinutes: Math.round(age) });
      }
    }
  }

  return {
    source: 'Ukraine Air Raid Alerts',
    timestamp: new Date().toISOString(),
    recencyWindowMinutes: RECENCY_WINDOW_MIN,
    activeAirAlertCount: activeAir.length,
    activeAirAlerts: activeAir,
    typeCounts,
    staleOrOtherAlerts: otherAlerts.slice(0, 20),
  };
}

if (process.argv[1]?.endsWith('ukraine-alerts.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
