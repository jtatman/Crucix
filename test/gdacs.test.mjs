// GDACS — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { briefing, parseFeed } from '../apis/sources/gdacs.mjs';

function item({ eventId, eventType, alertLevel, alertScore, country = 'Testland', iso3 = 'TST' }) {
  return `<item>
    <title>Test event</title>
    <gdacs:eventid>${eventId}</gdacs:eventid>
    <gdacs:eventtype>${eventType}</gdacs:eventtype>
    <gdacs:alertlevel>${alertLevel}</gdacs:alertlevel>
    <gdacs:alertscore>${alertScore}</gdacs:alertscore>
    <gdacs:country>${country}</gdacs:country>
    <gdacs:iso3>${iso3}</gdacs:iso3>
    <gdacs:population unit="Population Affected" value="100">100</gdacs:population>
    <gdacs:severity unit="M" value="5.5">Magnitude 5.5M</gdacs:severity>
    <gdacs:fromdate>Mon, 31 Aug 2026 00:00:00 GMT</gdacs:fromdate>
    <gdacs:todate>Mon, 31 Aug 2026 06:00:00 GMT</gdacs:todate>
    <geo:Point><geo:lat>1.23</geo:lat><geo:long>4.56</geo:long></geo:Point>
    <link>https://example.com/${eventId}</link>
  </item>`;
}

const SAMPLE_FEED = `<rss><channel>
  ${item({ eventId: 1, eventType: 'EQ', alertLevel: 'Green', alertScore: 0.1 })}
  ${item({ eventId: 2, eventType: 'TC', alertLevel: 'Red', alertScore: 5 })}
  ${item({ eventId: 3, eventType: 'FL', alertLevel: 'Orange', alertScore: 2 })}
  ${item({ eventId: 4, eventType: 'EQ', alertLevel: 'Green', alertScore: 0.05 })}
</channel></rss>`;

describe('parseFeed', () => {
  it('extracts and tallies events by type and alert level', () => {
    const result = parseFeed(SAMPLE_FEED);
    assert.equal(result.count, 4);
    assert.equal(result.redCount, 1);
    assert.equal(result.orangeCount, 1);
    assert.equal(result.greenCount, 2);
    assert.equal(result.byEventType.EQ, 2);
    assert.equal(result.byEventType.TC, 1);
  });

  it('sorts Red-first, then by alert score', () => {
    const result = parseFeed(SAMPLE_FEED);
    assert.equal(result.events[0].alertLevel, 'Red');
    assert.equal(result.maxAlertLevel, 'Red');
    assert.equal(result.maxAlertLevelNum, 2);
  });

  it('returns zero counts for a feed with no items', () => {
    const result = parseFeed('<rss><channel></channel></rss>');
    assert.equal(result.count, 0);
  });
});

describe('gdacs briefing', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns compact data on a successful fetch', async () => {
    globalThis.fetch = mock.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(SAMPLE_FEED) }));
    const result = await briefing();
    assert.equal(result.source, 'GDACS');
    assert.equal(result.count, 4);
  });

  it('degrades gracefully on a fetch error', async () => {
    globalThis.fetch = mock.fn(() => Promise.reject(new Error('offline')));
    const result = await briefing();
    assert.ok(result.error);
  });

  it('flags a non-fatal note when a non-empty body yields zero items', async () => {
    globalThis.fetch = mock.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve('<rss><channel>some unrelated content</channel></rss>') }));
    const result = await briefing();
    assert.equal(result.count, 0);
    assert.ok(result.note);
    assert.equal(result.error, undefined);
  });
});
