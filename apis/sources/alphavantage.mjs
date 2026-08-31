// Alpha Vantage NEWS_SENTIMENT — per-article and per-ticker sentiment scoring
// for financial/macro news. Free tier is 25 requests/day (verified via
// Alpha Vantage's own docs, 2026-08-31) — far too tight for the 15-minute
// sweep cadence (96 sweeps/day), so this runs on its own throttle via
// apis/utils/daily-cache.mjs rather than every sweep. MIN_INTERVAL_HOURS=23
// keeps this to essentially one real call per day (leaving 24 requests/day
// of headroom for manual debugging) with a small safety margin under 24h so
// drift across sweep boundaries can't push it over the daily cap.
//
// Requires ALPHAVANTAGE_API_KEY (user-supplied) — degrades to a structured
// error, like every other keyed source here, when unset.

import { safeFetch } from '../utils/fetch.mjs';
import '../utils/env.mjs';
import { getOrFetchThrottled } from '../utils/daily-cache.mjs';

const BASE = 'https://www.alphavantage.co/query';
const MIN_INTERVAL_HOURS = 23;
const TOPICS = 'financial_markets,economy_macro';

// Alpha Vantage timestamps are "YYYYMMDDTHHMMSS" with no separators/timezone
// (always UTC) — normalize to ISO 8601 for consistency with every other source.
export function parseAVTimestamp(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(s || '');
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${se}Z`;
}

function compactArticle(a) {
  return {
    title: a.title,
    url: a.url,
    source: a.source,
    timePublished: parseAVTimestamp(a.time_published),
    sentimentScore: parseFloat(a.overall_sentiment_score) || 0,
    sentimentLabel: a.overall_sentiment_label,
    topics: (a.topics || []).map(t => t.topic),
    topTicker: (a.ticker_sentiment || [])[0]
      ? {
          ticker: a.ticker_sentiment[0].ticker,
          score: parseFloat(a.ticker_sentiment[0].ticker_sentiment_score) || 0,
          label: a.ticker_sentiment[0].ticker_sentiment_label,
        }
      : null,
  };
}

async function fetchNewsSentiment(apiKey) {
  const params = new URLSearchParams({
    function: 'NEWS_SENTIMENT',
    topics: TOPICS,
    sort: 'LATEST',
    limit: '50',
    apikey: apiKey,
  });
  const result = await safeFetch(`${BASE}?${params}`);

  if (result?.error) return { source: 'Alpha Vantage', error: result.error };
  if (result?.Information || result?.Note) {
    // Alpha Vantage returns HTTP 200 with an "Information"/"Note" field on
    // rate-limit or invalid-key errors instead of a real HTTP error status.
    return { source: 'Alpha Vantage', error: result.Information || result.Note };
  }

  const feed = Array.isArray(result?.feed) ? result.feed : [];
  const articles = feed.map(compactArticle);
  const avgSentiment = articles.length
    ? articles.reduce((s, a) => s + a.sentimentScore, 0) / articles.length
    : 0;

  return {
    source: 'Alpha Vantage',
    timestamp: new Date().toISOString(),
    articleCount: articles.length,
    avgSentimentScore: parseFloat(avgSentiment.toFixed(4)),
    articles,
  };
}

export async function briefing(apiKey = process.env.ALPHAVANTAGE_API_KEY) {
  if (!apiKey) {
    return {
      source: 'Alpha Vantage',
      error: 'ALPHAVANTAGE_API_KEY not set',
      hint: 'Get a free key at https://www.alphavantage.co/support/#api-key, then set ALPHAVANTAGE_API_KEY in .env',
    };
  }
  return getOrFetchThrottled('alphavantage', () => fetchNewsSentiment(apiKey), { minIntervalHours: MIN_INTERVAL_HOURS });
}

if (process.argv[1]?.endsWith('alphavantage.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
