// Finnhub news + sentiment — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/finnhub.mjs';

function mockResponses(map) {
  return mock.fn((url) => {
    const key = Object.keys(map).find(k => url.includes(k));
    const body = map[key];
    return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(body)) });
  });
}

describe('finnhub briefing', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('degrades gracefully with a structured error when no API key is set', async () => {
    const result = await briefing('');
    assert.match(result.error, /FINNHUB_API_KEY/);
    assert.ok(result.hint);
  });

  it('combines general news and per-sector sentiment', async () => {
    globalThis.fetch = mockResponses({
      '/news?': [
        { headline: 'Markets rally', summary: 'Stocks up', source: 'Reuters', url: 'https://x.com/1', datetime: 1788168260, category: 'general' },
      ],
      'symbol=JPM': { sentiment: { bullishPercent: 0.6, bearishPercent: 0.4 }, companyNewsScore: 0.7, buzz: { articlesInLastWeek: 10 } },
      'symbol=AAPL': { sentiment: { bullishPercent: 0.8, bearishPercent: 0.2 }, companyNewsScore: 0.9, buzz: { articlesInLastWeek: 20 } },
      'symbol=XOM': { sentiment: { bullishPercent: 0.4, bearishPercent: 0.6 }, companyNewsScore: 0.3, buzz: { articlesInLastWeek: 5 } },
    });

    const result = await briefing('fake-key');
    assert.equal(result.articleCount, 1);
    assert.equal(result.articles[0].headline, 'Markets rally');
    assert.equal(result.sectorSentiment.length, 3);
    assert.ok(result.avgBullishPercent > 0.5 && result.avgBullishPercent < 0.7);
  });

  it('reports a hard error only when both news and sentiment fail', async () => {
    globalThis.fetch = mock.fn(() => Promise.reject(new Error('network down')));
    const result = await briefing('fake-key');
    assert.match(result.error, /network down/);
  });

  it('still returns sentiment data when only the general news call fails', async () => {
    globalThis.fetch = mock.fn((url) => {
      if (url.includes('/news?')) return Promise.reject(new Error('news endpoint down'));
      return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({
        sentiment: { bullishPercent: 0.5, bearishPercent: 0.5 }, companyNewsScore: 0.5, buzz: { articlesInLastWeek: 1 },
      })) });
    });

    const result = await briefing('fake-key');
    assert.equal(result.error, undefined);
    assert.equal(result.articleCount, 0);
    assert.ok(result.newsError);
    assert.equal(result.sectorSentiment.length, 3);
  });
});
