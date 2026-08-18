// Cross-stream correlation — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeDelta, computeCrossStreamCorrelation } from '../lib/delta/engine.mjs';

function baseline() {
  return {
    meta: { timestamp: '2026-01-01T00:00:00Z', sourcesOk: 29 },
    fred: [
      { id: 'VIXCLS', value: 15 },
      { id: 'BAMLH0A0HYM2', value: 3 },
    ],
    acled: { totalEvents: 10, totalFatalities: 5 },
    thermal: [{ det: 100 }],
    tg: { urgent: [{ postId: 'p1', text: 'calm' }] },
    who: [],
    health: [],
    nuke: [],
  };
}

describe('computeCrossStreamCorrelation', () => {
  it('is inactive with no signals', () => {
    const c = computeCrossStreamCorrelation({ new: [], escalated: [], deescalated: [], unchanged: [] });
    assert.equal(c.active, false);
  });

  it('is inactive when fewer domains than the threshold trigger', () => {
    const signals = {
      new: [],
      escalated: [
        { key: 'vix', domain: 'market', severity: 'moderate' },
        { key: 'fed_funds', domain: 'market', severity: 'moderate' }, // same domain, doesn't add a new one
      ],
      deescalated: [], unchanged: [],
    };
    const c = computeCrossStreamCorrelation(signals);
    assert.equal(c.active, false);
    assert.deepEqual(c.domainsTriggered, ['market']);
  });

  it('activates once signals span the domain threshold', () => {
    const signals = {
      new: [{ key: 'tg_urgent:x', domain: 'osint', severity: 'moderate' }],
      escalated: [
        { key: 'vix', domain: 'market', severity: 'moderate' },
        { key: 'conflict_events', domain: 'conflict', severity: 'moderate' },
      ],
      deescalated: [], unchanged: [],
    };
    const c = computeCrossStreamCorrelation(signals);
    assert.equal(c.active, true);
    assert.equal(c.domainsTriggered.length, 3);
    assert.equal(c.severity, 'moderate');
  });

  it('escalates severity to critical if any contributing signal is critical', () => {
    const signals = {
      new: [{ key: 'tg_urgent:x', domain: 'osint', severity: 'critical' }],
      escalated: [
        { key: 'vix', domain: 'market', severity: 'moderate' },
        { key: 'conflict_events', domain: 'conflict', severity: 'moderate' },
      ],
      deescalated: [], unchanged: [],
    };
    const c = computeCrossStreamCorrelation(signals);
    assert.equal(c.severity, 'critical');
  });

  it('ignores infrastructure/media domains (our own monitoring health, not world state)', () => {
    const signals = {
      new: [],
      escalated: [
        { key: 'vix', domain: 'market', severity: 'moderate' },
        { key: 'conflict_events', domain: 'conflict', severity: 'moderate' },
        { key: 'sources_ok', domain: 'infrastructure', severity: 'moderate' },
        { key: 'news_count', domain: 'media', severity: 'moderate' },
      ],
      deescalated: [], unchanged: [],
    };
    const c = computeCrossStreamCorrelation(signals);
    assert.equal(c.active, false); // only 2 substantive domains (market, conflict)
  });

  it('respects a minDomains override', () => {
    const signals = {
      new: [],
      escalated: [
        { key: 'vix', domain: 'market', severity: 'moderate' },
        { key: 'conflict_events', domain: 'conflict', severity: 'moderate' },
      ],
      deescalated: [], unchanged: [],
    };
    const c = computeCrossStreamCorrelation(signals, { minDomains: 2 });
    assert.equal(c.active, true);
  });
});

describe('computeDelta correlation integration', () => {
  it('attaches an inactive correlation when nothing much changed', () => {
    const prev = baseline();
    const curr = baseline();
    curr.meta.timestamp = '2026-01-01T00:15:00Z';
    const delta = computeDelta(curr, prev);
    assert.ok(delta.correlation);
    assert.equal(delta.correlation.active, false);
  });

  it('flags a convergence when market + conflict + disaster + osint move together', () => {
    const prev = baseline();
    const curr = baseline();
    curr.meta.timestamp = '2026-01-01T00:15:00Z';
    curr.fred = [{ id: 'VIXCLS', value: 25 }, { id: 'BAMLH0A0HYM2', value: 3 }]; // +66% > 5% threshold
    curr.acled = { totalEvents: 30, totalFatalities: 5 }; // +20 >= 5 threshold
    curr.thermal = [{ det: 700 }]; // +600 >= 500 threshold
    curr.tg = { urgent: [{ postId: 'p1', text: 'calm' }, { postId: 'p2', text: 'new urgent signal' }] };

    const delta = computeDelta(curr, prev);
    assert.equal(delta.correlation.active, true);
    assert.ok(delta.correlation.domainsTriggered.length >= 3);
  });
});
