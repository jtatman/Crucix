// USGS Earthquake — real-time seismic activity (GeoJSON summary feed)
// No auth required, no rate limit documented — this is the standard public
// feed used by countless earthquake-notification apps and updates on a
// sub-5-minute cadence upstream.
//
// Fills a real gap: crucix tracks nuclear/radiation (Safecast, EPA RadNet)
// and weather (NOAA) but had zero seismic coverage before this.

import { safeFetch } from '../utils/fetch.mjs';

// M4.5+, past day — globally significant without being noisy (M2.5+ fires
// hundreds of times a day, mostly minor/local events with no cross-domain
// relevance to the rest of what crucix tracks).
const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson';

function compactQuake(feature) {
  const p = feature.properties || {};
  const [lon, lat, depthKm] = feature.geometry?.coordinates || [];
  return {
    mag: p.mag,
    place: p.place,
    time: p.time ? new Date(p.time).toISOString() : null,
    lat, lon, depthKm,
    alert: p.alert || null, // PAGER impact alert: green/yellow/orange/red, or null if not assessed
    tsunami: Boolean(p.tsunami),
    url: p.url,
  };
}

export async function briefing() {
  const result = await safeFetch(FEED_URL);
  if (result?.error) {
    return { source: 'USGS Earthquake', error: result.error };
  }

  const features = Array.isArray(result?.features) ? result.features : [];
  const quakes = features.map(compactQuake).sort((a, b) => (b.mag || 0) - (a.mag || 0));

  return {
    source: 'USGS Earthquake',
    timestamp: new Date().toISOString(),
    count: quakes.length,
    maxMagnitude: quakes.length ? quakes[0].mag : 0,
    tsunamiWarnings: quakes.filter(q => q.tsunami).length,
    pagerAlerts: quakes.filter(q => q.alert && q.alert !== 'green').length,
    quakes,
  };
}

if (process.argv[1]?.endsWith('usgs-earthquake.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
