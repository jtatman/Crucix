// Alpha Vantage NEWS_SENTIMENT — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'fs';
import { join } from 'path';
import { briefing, parseAVTimestamp } from '../apis/sources/alphavantage.mjs';

const CACHE_PATH = join(process.cwd(), 'runs', 'daily-cache', 'alphavantage.json');

describe('parseAVTimestamp', () => {
  it('converts AV compact timestamps to ISO 8601', () => {
    assert.equal(parseAVTimestamp('20260831T080634'), '2026-08-31T08:06:34Z');
  });

  it('returns null for malformed input', () => {
    assert.equal(parseAVTimestamp('not-a-timestamp'), null);
    assert.equal(parseAVTimestamp(undefined), null);
  });
});

describe('alphavantage briefing', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });
  after(() => { try { rmSync(CACHE_PATH); } catch { /* may not exist */ } });

  it('degrades gracefully with a structured error when no API key is set', async () => {
    // Pass '' rather than undefined — undefined would fall through to the
    // real ALPHAVANTAGE_API_KEY default param, which may genuinely be set
    // in this shell's environment.
    const result = await briefing('');
    assert.match(result.error, /ALPHAVANTAGE_API_KEY/);
    assert.ok(result.hint);
  });

  it('maps feed articles into the compact shape', async () => {
    try { rmSync(CACHE_PATH); } catch { /* ensure a fresh throttle window, not a leftover live-run cache */ }
    const payload = {
      feed: [{
        title: 'Test Headline',
        url: 'https://example.com/a',
        source: 'Example Wire',
        time_published: '20260831T080634',
        overall_sentiment_score: '0.4',
        overall_sentiment_label: 'Bullish',
        topics: [{ topic: 'earnings', relevance_score: '0.9' }],
        ticker_sentiment: [{ ticker: 'ABC', ticker_sentiment_score: '0.5', ticker_sentiment_label: 'Bullish' }],
      }],
    };
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(payload)) })
    );

    const result = await briefing('fake-key');
    assert.equal(result.articleCount, 1);
    assert.equal(result.articles[0].title, 'Test Headline');
    assert.equal(result.articles[0].timePublished, '2026-08-31T08:06:34Z');
    assert.equal(result.articles[0].topTicker.ticker, 'ABC');
    assert.equal(result.avgSentimentScore, 0.4);
  });

  it('treats an Alpha Vantage "Information" rate-limit payload as an error', async () => {
    try { rmSync(CACHE_PATH); } catch { /* ensure a fresh throttle window */ }
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ Information: 'Rate limit reached' })) })
    );
    const result = await briefing('fake-key');
    assert.match(result.error, /Rate limit/);
  });
});
