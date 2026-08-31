// GDELT media-volume corroboration — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectVolumeSurge } from '../apis/sources/gdelt.mjs';
import { computeDelta } from '../lib/delta/engine.mjs';

function timeline(values) {
  return { timeline: [{ series: 'Volume Intensity', data: values.map((value, i) => ({ date: `t${i}`, value })) }] };
}

describe('detectVolumeSurge', () => {
  it('reports insufficient data on a short timeline', () => {
    const r = detectVolumeSurge(timeline([1, 2, 3]));
    assert.equal(r.surging, false);
    assert.equal(r.ratio, null);
  });

  it('does not flag a surge on a flat timeline', () => {
    const flat = Array(40).fill(20);
    const r = detectVolumeSurge(timeline(flat));
    assert.equal(r.surging, false);
    assert.equal(r.ratio, 1);
  });

  it('flags a surge when the recent buckets spike well above baseline', () => {
    const baseline = Array(36).fill(20);
    const spike = [60, 65, 58, 62];
    const r = detectVolumeSurge(timeline([...baseline, ...spike]));
    assert.equal(r.surging, true);
    assert.ok(r.ratio >= 1.25);
  });

  it('respects a custom surgeRatio threshold', () => {
    const baseline = Array(36).fill(20);
    const mild = [24, 24, 24, 24]; // 1.2x — below default 1.25 threshold
    const r1 = detectVolumeSurge(timeline([...baseline, ...mild]));
    assert.equal(r1.surging, false);
    const r2 = detectVolumeSurge(timeline([...baseline, ...mild]), { surgeRatio: 1.1 });
    assert.equal(r2.surging, true);
  });
});

describe('computeDelta — GDELT corroboration gate on tg_urgent signals', () => {
  function baseRun(overrides = {}) {
    return {
      meta: { timestamp: '2026-01-01T00:00:00Z', sourcesOk: 29 },
      fred: [], acled: {}, thermal: [], who: [], health: [], nuke: [],
      tg: { urgent: [] },
      gdelt: { mediaVolume: { surging: false, ratio: 1 } },
      ...overrides,
    };
  }

  it('marks a new urgent post as moderate/uncorroborated when GDELT shows no surge', () => {
    const previous = baseRun();
    const current = baseRun({
      tg: { urgent: [{ postId: 'p1', text: 'breaking missile strike' }] },
    });
    const delta = computeDelta(current, previous);
    const sig = delta.signals.new.find(s => s.key.startsWith('tg_urgent'));
    assert.ok(sig);
    assert.equal(sig.corroborated, false);
    assert.equal(sig.severity, 'moderate');
    assert.equal(delta.summary.criticalChanges, 0);
  });

  it('marks a new urgent post as critical/corroborated when GDELT confirms a media surge', () => {
    const previous = baseRun();
    const current = baseRun({
      tg: { urgent: [{ postId: 'p1', text: 'breaking missile strike' }] },
      gdelt: { mediaVolume: { surging: true, ratio: 1.8 } },
    });
    const delta = computeDelta(current, previous);
    const sig = delta.signals.new.find(s => s.key.startsWith('tg_urgent'));
    assert.ok(sig);
    assert.equal(sig.corroborated, true);
    assert.equal(sig.severity, 'critical');
    assert.equal(delta.summary.criticalChanges, 1);
  });

  it('still surfaces uncorroborated posts in signals.new (not silently dropped)', () => {
    const previous = baseRun();
    const current = baseRun({
      tg: { urgent: [{ postId: 'p1', text: 'a' }, { postId: 'p2', text: 'b' }] },
    });
    const delta = computeDelta(current, previous);
    const osint = delta.signals.new.filter(s => s.key.startsWith('tg_urgent'));
    assert.equal(osint.length, 2);
  });
});
