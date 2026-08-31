// ISW (Institute for the Study of War) daily campaign assessments.
// No auth, but no official API either: understandingwar.org explicitly
// disables its own RSS feed ("Yoast SEO: We disable the RSS feed for
// performance reasons" — verified via response header 2026-08-31), and its
// sister site criticalthreats.org (same content, no such block) has none.
// There is also no documented or machine-readable publish time anywhere on
// either site (verified: no article:published_time / dateModified meta, day
// granularity only) — so instead of guessing an hour-of-day offset, this
// polls the /analysis listing page (cheap: one HTML page, no rate limit
// observed) and, via apis/utils/daily-cache.mjs, only does a real fetch at
// most once every MIN_INTERVAL_HOURS. Whichever sweep happens to land after
// that day's assessment goes up picks it up; every other sweep gets the
// cached result. This also naturally covers Iran, which ISW/CriticalThreats
// publishes on the same cadence as a separate daily series.

import { getOrFetchThrottled } from '../utils/daily-cache.mjs';

const LIST_URL = 'https://www.criticalthreats.org/analysis';
const MIN_INTERVAL_HOURS = 20;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const SERIES = [
  { slug: 'russian-offensive-campaign-assessment-', label: 'Russia-Ukraine' },
  { slug: 'iran-update-', label: 'Iran' },
];

async function fetchHTML(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// ISW's "Key Takeaways" bullet list has moved position between top and
// bottom of the article across different report templates — search by
// content pattern, not position.
export function extractKeyTakeaways(html) {
  const m = html.match(/Key Takeaways:?<\/strong>[\s\S]{0,20}?<ul>([\s\S]*?)<\/ul>/i);
  if (!m) return [];
  const items = [...m[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
  return items.map(i => stripTags(i[1])).filter(Boolean);
}

async function findLatestUrl(listHtml, seriesSlug) {
  const re = new RegExp(`href="(/analysis/${seriesSlug}[a-z0-9-]*)"`, 'i');
  const m = listHtml.match(re);
  return m ? `https://www.criticalthreats.org${m[1]}` : null;
}

async function fetchLatestAssessment(listHtml, series) {
  const url = await findLatestUrl(listHtml, series.slug);
  if (!url) return { label: series.label, error: `No ${series.label} link found on listing page` };

  const html = await fetchHTML(url);
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  return {
    label: series.label,
    url,
    title: titleMatch ? titleMatch[1].replace(/\s*\|.*$/, '').trim() : series.label,
    keyTakeaways: extractKeyTakeaways(html),
  };
}

async function fetchAll() {
  const listHtml = await fetchHTML(LIST_URL);
  const results = await Promise.all(SERIES.map(s => fetchLatestAssessment(listHtml, s)));
  return {
    source: 'ISW',
    timestamp: new Date().toISOString(),
    assessments: results.filter(r => !r.error),
    errors: results.filter(r => r.error).map(r => `${r.label}: ${r.error}`),
  };
}

export async function briefing() {
  return getOrFetchThrottled('isw', fetchAll, { minIntervalHours: MIN_INTERVAL_HOURS });
}

if (process.argv[1]?.endsWith('isw.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
