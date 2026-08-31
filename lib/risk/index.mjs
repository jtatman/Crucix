// Composite Risk Index — a single 0-100 "how elevated is world stress right now"
// score, built from data already collected each sweep (no new sources, no new
// API calls, no LLM). Deliberately restricted to mean-reverting/bounded metrics
// (VIX, HY spread, yield-curve spread, unemployment rate) and current activity
// counts (conflict events/fatalities, thermal detections, WHO alerts, urgent
// OSINT posts) — absolute price *levels* (gold, oil, index points) are excluded
// on purpose: a fixed "calm vs crisis" price band goes stale as markets drift
// over months, the same failure mode that froze the dashboard on months-old
// data (see jarvis.html's inline-D bug). Counts and bounded rates don't drift
// the same way, so a fixed band stays meaningful far longer.

const DEFAULT_RISK_THRESHOLDS = {
  vix: { calm: 12, crisis: 40 },
  hy_spread: { calm: 3, crisis: 8 },
  // Yield curve: less negative (or positive) is calm, more inverted is worse.
  yield_curve: { calm: 0.5, crisis: -1, invert: true },
  unemployment: { calm: 4, crisis: 8 },
  conflict_events: { calm: 0, crisis: 300 },
  conflict_fatalities: { calm: 0, crisis: 500 },
  thermal_total: { calm: 0, crisis: 15000 },
  who_alerts: { calm: 0, crisis: 10 },
  urgent_posts: { calm: 0, crisis: 20 },
  // Magnitude scale is bounded (not drift-prone like a price), so a fixed
  // band is safe: M4.5+ happens most days somewhere (calm floor), M7.5+ is
  // major/great-earthquake territory.
  earthquake_max_mag: { calm: 4.5, crisis: 7.5 },
  gdacs_alert_level: { calm: 0, crisis: 2 },
  severe_weather_locations: { calm: 0, crisis: 6 },
  // Kp index: bounded 0-9 scale, G3+ storm territory starts at Kp 7.
  swpc_kp: { calm: 3, crisis: 7 },
};

const RISK_COMPONENTS = [
  { key: 'vix', domain: 'market', label: 'VIX', extract: d => d.fred?.find(f => f.id === 'VIXCLS')?.value },
  { key: 'hy_spread', domain: 'market', label: 'HY Spread', extract: d => d.fred?.find(f => f.id === 'BAMLH0A0HYM2')?.value },
  { key: 'yield_curve', domain: 'market', label: '10Y-2Y Spread', extract: d => d.fred?.find(f => f.id === 'T10Y2Y')?.value },
  { key: 'unemployment', domain: 'labor', label: 'Unemployment', extract: d => d.bls?.find(b => b.id === 'LNS14000000' || b.id === 'UNRATE')?.value },
  { key: 'conflict_events', domain: 'conflict', label: 'Conflict Events', extract: d => d.acled?.totalEvents },
  { key: 'conflict_fatalities', domain: 'conflict', label: 'Conflict Fatalities', extract: d => d.acled?.totalFatalities },
  { key: 'thermal_total', domain: 'disaster', label: 'Thermal Detections', extract: d => d.thermal?.reduce((s, t) => s + t.det, 0) },
  { key: 'who_alerts', domain: 'health', label: 'WHO Alerts', extract: d => d.who?.length },
  { key: 'urgent_posts', domain: 'osint', label: 'Urgent OSINT Posts', extract: d => d.tg?.urgent?.length },
  { key: 'earthquake_max_mag', domain: 'disaster', label: 'Max Earthquake Magnitude', extract: d => d.earthquakes?.maxMagnitude },
  { key: 'gdacs_alert_level', domain: 'disaster', label: 'GDACS Max Alert Level', extract: d => d.gdacs?.maxAlertLevelNum },
  { key: 'severe_weather_locations', domain: 'disaster', label: 'Severe Weather Locations', extract: d => d.openMeteo?.severeCount },
  { key: 'swpc_kp', domain: 'space', label: 'Planetary Kp Index', extract: d => d.swpc?.kp },
];

function normalize(value, band) {
  if (value == null || Number.isNaN(value)) return null;
  const { calm, crisis, invert } = band;
  const t = invert ? (calm - value) / (calm - crisis) : (value - calm) / (crisis - calm);
  return Math.max(0, Math.min(100, t * 100));
}

/**
 * @param {object} current - synthesized dashboard data for one sweep
 * @param {object} [thresholdOverrides] - per-key { calm, crisis, invert } overrides
 * @returns {{score: number, level: string, domains: object, components: Array}|null}
 */
export function computeRiskIndex(current, thresholdOverrides = {}) {
  if (!current) return null;

  const thresholds = { ...DEFAULT_RISK_THRESHOLDS, ...thresholdOverrides };
  const components = [];

  for (const c of RISK_COMPONENTS) {
    const band = thresholds[c.key];
    if (!band) continue;
    const raw = c.extract(current);
    const score = normalize(raw, band);
    if (score == null) continue;
    components.push({ key: c.key, label: c.label, domain: c.domain, value: raw, score: Math.round(score) });
  }

  if (!components.length) return null;

  // Average within domain first so a domain with more sub-metrics (e.g.
  // 'market' has 3) doesn't dominate the overall score just by having more
  // components than a single-metric domain like 'health'.
  const byDomain = new Map();
  for (const c of components) {
    if (!byDomain.has(c.domain)) byDomain.set(c.domain, []);
    byDomain.get(c.domain).push(c.score);
  }
  const domainScores = [...byDomain.entries()].map(([domain, scores]) => ({
    domain,
    score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
  }));

  const overall = Math.round(domainScores.reduce((a, d) => a + d.score, 0) / domainScores.length);
  const level = overall >= 75 ? 'critical' : overall >= 50 ? 'high' : overall >= 25 ? 'elevated' : 'low';

  return {
    score: overall,
    level,
    domains: Object.fromEntries(domainScores.map(d => [d.domain, d.score])),
    components,
  };
}

export { DEFAULT_RISK_THRESHOLDS };
