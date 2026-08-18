// Composite Risk Index — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeRiskIndex, DEFAULT_RISK_THRESHOLDS } from '../lib/risk/index.mjs';

const calmData = {
  fred: [
    { id: 'VIXCLS', value: 12 },
    { id: 'BAMLH0A0HYM2', value: 3 },
    { id: 'T10Y2Y', value: 0.5 },
  ],
  bls: [{ id: 'UNRATE', value: 4 }],
  acled: { totalEvents: 0, totalFatalities: 0 },
  thermal: [{ det: 0 }],
  who: [],
  tg: { urgent: [] },
};

const crisisData = {
  fred: [
    { id: 'VIXCLS', value: 40 },
    { id: 'BAMLH0A0HYM2', value: 8 },
    { id: 'T10Y2Y', value: -1 },
  ],
  bls: [{ id: 'UNRATE', value: 8 }],
  acled: { totalEvents: 300, totalFatalities: 500 },
  thermal: [{ det: 15000 }],
  who: new Array(10).fill({ title: 'x' }),
  tg: { urgent: new Array(20).fill({ text: 'x' }) },
};

describe('computeRiskIndex', () => {
  it('returns null for missing data', () => {
    assert.equal(computeRiskIndex(null), null);
  });

  it('returns null when no known metrics are present', () => {
    assert.equal(computeRiskIndex({}), null);
  });

  it('scores calm data near 0 and labels it low', () => {
    const r = computeRiskIndex(calmData);
    assert.ok(r.score <= 5, `expected near-0 score, got ${r.score}`);
    assert.equal(r.level, 'low');
  });

  it('scores crisis-band data near 100 and labels it critical', () => {
    const r = computeRiskIndex(crisisData);
    assert.ok(r.score >= 95, `expected near-100 score, got ${r.score}`);
    assert.equal(r.level, 'critical');
  });

  it('breaks the score down by domain', () => {
    const r = computeRiskIndex(crisisData);
    assert.ok('market' in r.domains);
    assert.ok('conflict' in r.domains);
    assert.ok('labor' in r.domains);
    assert.ok('disaster' in r.domains);
    assert.ok('health' in r.domains);
    assert.ok('osint' in r.domains);
  });

  it('does not let a multi-metric domain dominate a single-metric domain', () => {
    // market has 3 sub-metrics, health has 1 — both calm, both should score ~0
    // regardless of how many sub-metrics feed into them.
    const r = computeRiskIndex(calmData);
    assert.equal(r.domains.market, 0);
    assert.equal(r.domains.health, 0);
  });

  it('excludes price-level metrics (gold/oil/index points) entirely', () => {
    const r = computeRiskIndex(crisisData);
    const keys = r.components.map(c => c.key);
    assert.ok(!keys.includes('gold'));
    assert.ok(!keys.includes('wti'));
  });

  it('respects threshold overrides', () => {
    const lenient = computeRiskIndex({ fred: [{ id: 'VIXCLS', value: 20 }] }, { vix: { calm: 0, crisis: 20 } });
    assert.equal(lenient.score, 100);
    const strict = computeRiskIndex({ fred: [{ id: 'VIXCLS', value: 20 }] }, { vix: DEFAULT_RISK_THRESHOLDS.vix });
    assert.ok(strict.score < 100);
  });

  it('skips components with missing values without throwing', () => {
    const r = computeRiskIndex({ fred: [{ id: 'VIXCLS', value: 25 }] });
    assert.equal(r.components.length, 1);
    assert.equal(r.components[0].key, 'vix');
  });
});
