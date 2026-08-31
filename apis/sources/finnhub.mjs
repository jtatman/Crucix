// Finnhub — market news + per-ticker news sentiment
// Free tier is 60 requests/minute (per Finnhub's docs) — generous enough to
// run on the normal 15-minute sweep cadence, unlike Alpha Vantage's 25/day.
//
// Finnhub's sentiment endpoint (/news-sentiment) is per-company, not a
// general macro/topic score like Alpha Vantage's — it requires a specific
// ticker. Crucix's existing yfinance.mjs symbol list is all indexes/ETFs/
// futures (^GSPC, GC=F, BTC-USD, ...), which that endpoint doesn't support
// (it wants individual equities). Rather than force a mismatch, this uses a
// small fixed basket of sector-bellwether single stocks — not to track
// those companies specifically, but as a cheap proxy for sector-level mood
// (financials, tech, energy) alongside Alpha Vantage's broader macro score.
//
// Requires FINNHUB_API_KEY (user-supplied, free at finnhub.io/register) —
// degrades to a structured error, like every other keyed source here, when
// unset.

import { safeFetch } from '../utils/fetch.mjs';
import '../utils/env.mjs';

const BASE = 'https://finnhub.io/api/v1';
const SENTIMENT_BASKET = {
  JPM: 'Financials',
  AAPL: 'Technology',
  XOM: 'Energy',
};

function compactNewsItem(n) {
  return {
    headline: n.headline,
    summary: n.summary,
    source: n.source,
    url: n.url,
    time: n.datetime ? new Date(n.datetime * 1000).toISOString() : null,
    category: n.category,
  };
}

async function fetchGeneralNews(apiKey) {
  const params = new URLSearchParams({ category: 'general', token: apiKey });
  const result = await safeFetch(`${BASE}/news?${params}`);
  if (result?.error) return { error: result.error };
  if (!Array.isArray(result)) return { error: 'Unexpected response shape from /news' };
  return { articles: result.slice(0, 30).map(compactNewsItem) };
}

async function fetchSentimentBasket(apiKey) {
  const entries = await Promise.all(
    Object.entries(SENTIMENT_BASKET).map(async ([symbol, sector]) => {
      const params = new URLSearchParams({ symbol, token: apiKey });
      const result = await safeFetch(`${BASE}/news-sentiment?${params}`);
      if (result?.error || !result?.sentiment) return { symbol, sector, error: result?.error || 'no sentiment data' };
      return {
        symbol,
        sector,
        bullishPercent: result.sentiment.bullishPercent,
        bearishPercent: result.sentiment.bearishPercent,
        companyNewsScore: result.companyNewsScore,
        articlesInLastWeek: result.buzz?.articlesInLastWeek || 0,
      };
    })
  );
  return entries;
}

export async function briefing(apiKey = process.env.FINNHUB_API_KEY) {
  if (!apiKey) {
    return {
      source: 'Finnhub',
      error: 'FINNHUB_API_KEY not set',
      hint: 'Get a free key at https://finnhub.io/register, then set FINNHUB_API_KEY in .env',
    };
  }

  const [news, sentiment] = await Promise.all([
    fetchGeneralNews(apiKey),
    fetchSentimentBasket(apiKey),
  ]);

  if (news.error && sentiment.every(s => s.error)) {
    return { source: 'Finnhub', error: news.error };
  }

  const validSentiment = sentiment.filter(s => !s.error);
  const avgBullish = validSentiment.length
    ? validSentiment.reduce((s, e) => s + (e.bullishPercent || 0), 0) / validSentiment.length
    : null;

  return {
    source: 'Finnhub',
    timestamp: new Date().toISOString(),
    articleCount: news.articles?.length || 0,
    articles: news.articles || [],
    sectorSentiment: sentiment,
    avgBullishPercent: avgBullish !== null ? parseFloat(avgBullish.toFixed(3)) : null,
    ...(news.error ? { newsError: news.error } : {}),
  };
}

if (process.argv[1]?.endsWith('finnhub.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
