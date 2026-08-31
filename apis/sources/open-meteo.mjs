// Open-Meteo — free, keyless, global weather forecasts
// No auth, 10,000 calls/day free tier. Explicitly does NOT provide severe
// weather alerts itself (recommends NWS for that — see apis/sources/noaa.mjs,
// which already covers the US). This is the forecasting-overlay complement:
// global coverage, current conditions + short-term forecast, for a small
// curated set of locations already central to crucix's other coverage
// (conflict zones, financial centers, severe-weather-prone population
// centers) rather than every location the dashboard geo-tags text against.
//
// The forecast endpoint accepts comma-joined multi-location lat/lon lists in
// ONE request and returns results in request order (verified live) — so the
// whole monitored set costs one HTTP call per sweep, not one per location.

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://api.open-meteo.com/v1/forecast';

export const LOCATIONS = [
  { name: 'Kyiv', lat: 50.45, lon: 30.52 },
  { name: 'Moscow', lat: 55.75, lon: 37.62 },
  { name: 'Tehran', lat: 35.69, lon: 51.39 },
  { name: 'Tel Aviv', lat: 32.08, lon: 34.78 },
  { name: 'Taipei', lat: 25.03, lon: 121.56 },
  { name: 'Beijing', lat: 39.90, lon: 116.41 },
  { name: 'New York', lat: 40.71, lon: -74.01 },
  { name: 'London', lat: 51.51, lon: -0.13 },
  { name: 'Washington DC', lat: 38.90, lon: -77.04 },
  { name: 'Singapore', lat: 1.35, lon: 103.82 },
  { name: 'Mumbai', lat: 19.08, lon: 72.88 },
  { name: 'Manila', lat: 14.60, lon: 120.98 },
];

// WMO weather codes for thunderstorms, heavy/freezing rain, violent rain
// showers, and heavy snow. https://open-meteo.com/en/docs (WMO Weather code table)
const SEVERE_WEATHER_CODES = new Set([65, 67, 75, 82, 86, 95, 96, 99]);
const SEVERE_WIND_GUST_KMH = 60;
const SEVERE_PRECIPITATION_MM = 10;

function isSevere(current) {
  if (!current) return false;
  if (SEVERE_WEATHER_CODES.has(current.weather_code)) return true;
  if ((current.wind_gusts_10m || 0) >= SEVERE_WIND_GUST_KMH) return true;
  if ((current.precipitation || 0) >= SEVERE_PRECIPITATION_MM) return true;
  return false;
}

function compactLocation(loc, forecast) {
  const current = forecast?.current || {};
  return {
    name: loc.name,
    lat: forecast?.latitude ?? loc.lat,
    lon: forecast?.longitude ?? loc.lon,
    tempC: current.temperature_2m ?? null,
    precipitationMm: current.precipitation ?? null,
    windSpeedKmh: current.wind_speed_10m ?? null,
    windGustsKmh: current.wind_gusts_10m ?? null,
    weatherCode: current.weather_code ?? null,
    severe: isSevere(current),
    time: current.time || null,
  };
}

export async function briefing() {
  const params = new URLSearchParams({
    latitude: LOCATIONS.map(l => l.lat).join(','),
    longitude: LOCATIONS.map(l => l.lon).join(','),
    current: 'temperature_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
    timezone: 'UTC',
  });

  const result = await safeFetch(`${BASE}?${params}`);
  if (result?.error) return { source: 'Open-Meteo', error: result.error };
  if (!Array.isArray(result)) return { source: 'Open-Meteo', error: 'Unexpected response shape (not an array)' };

  const n = Math.min(result.length, LOCATIONS.length);
  const locations = [];
  for (let i = 0; i < n; i++) {
    locations.push(compactLocation(LOCATIONS[i], result[i]));
  }

  return {
    source: 'Open-Meteo',
    timestamp: new Date().toISOString(),
    locationsMonitored: locations.length,
    severeCount: locations.filter(l => l.severe).length,
    locations,
  };
}

if (process.argv[1]?.endsWith('open-meteo.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
