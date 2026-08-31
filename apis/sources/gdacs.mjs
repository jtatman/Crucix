// GDACS — Global Disaster Alert and Coordination System
// No auth required. Free, real-time RSS/XML feed (~400+ current items,
// verified live 2026-08-31), no documented rate limit.
//
// Extends the USGS earthquake work: covers cyclones/floods/volcanoes/
// wildfires USGS doesn't, with a pre-computed Green/Orange/Red alert level
// (community-consensus severity, not a raw magnitude).
//
// IMPORTANT: this is XML, not JSON. apis/utils/fetch.mjs's safeFetch()
// does JSON.parse() and silently falls back to `{ rawText: text.slice(0,500) }`
// on failure — that would truncate this feed to its channel header (zero
// items, no visible error). Do not use safeFetch here; fetch raw text
// directly, same as apis/sources/isw.mjs does for HTML.

const FEED_URL = 'https://www.gdacs.org/xml/rss.xml';
const ALERT_LEVEL_NUM = { Green: 0, Orange: 1, Red: 2 };

async function fetchXML(url, timeoutMs = 15000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

function attr(block, name, attrName) {
  const m = block.match(new RegExp(`<${name}\\s+[^>]*${attrName}="([^"]*)"`, 'i'));
  return m ? m[1] : null;
}

function compactEvent(block) {
  const alertLevel = tag(block, 'gdacs:alertlevel');
  const lat = tag(block, 'geo:lat');
  const lon = tag(block, 'geo:long');
  return {
    eventId: tag(block, 'gdacs:eventid'),
    eventType: tag(block, 'gdacs:eventtype'),
    alertLevel,
    alertLevelNum: ALERT_LEVEL_NUM[alertLevel] ?? 0,
    alertScore: parseFloat(tag(block, 'gdacs:alertscore')) || 0,
    country: tag(block, 'gdacs:country'),
    iso3: tag(block, 'gdacs:iso3'),
    populationAffected: parseInt(attr(block, 'gdacs:population', 'value'), 10) || 0,
    severityValue: parseFloat(attr(block, 'gdacs:severity', 'value')) || null,
    severityUnit: attr(block, 'gdacs:severity', 'unit') || null,
    fromDate: tag(block, 'gdacs:fromdate'),
    toDate: tag(block, 'gdacs:todate'),
    lat: lat ? parseFloat(lat) : null,
    lon: lon ? parseFloat(lon) : null,
    title: tag(block, 'title'),
    url: tag(block, 'link'),
  };
}

export function parseFeed(xml) {
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
  const events = blocks.map(compactEvent);

  const byEventType = {};
  for (const e of events) {
    if (e.eventType) byEventType[e.eventType] = (byEventType[e.eventType] || 0) + 1;
  }

  const sorted = [...events].sort((a, b) => b.alertLevelNum - a.alertLevelNum || b.alertScore - a.alertScore);
  const redCount = events.filter(e => e.alertLevel === 'Red').length;
  const orangeCount = events.filter(e => e.alertLevel === 'Orange').length;
  const greenCount = events.filter(e => e.alertLevel === 'Green').length;
  const maxAlertLevelNum = sorted.length ? sorted[0].alertLevelNum : 0;
  const maxAlertLevel = sorted.length ? sorted[0].alertLevel : null;

  return {
    count: events.length,
    redCount, orangeCount, greenCount,
    maxAlertLevel, maxAlertLevelNum,
    byEventType,
    events: sorted.slice(0, 20),
  };
}

export async function briefing() {
  let xml;
  try {
    xml = await fetchXML(FEED_URL);
  } catch (e) {
    return { source: 'GDACS', error: e.message };
  }

  const parsed = parseFeed(xml);
  if (parsed.count === 0) {
    return {
      source: 'GDACS',
      timestamp: new Date().toISOString(),
      ...parsed,
      note: 'No items parsed from a non-empty feed — GDACS feed format may have changed',
    };
  }

  return { source: 'GDACS', timestamp: new Date().toISOString(), ...parsed };
}

if (process.argv[1]?.endsWith('gdacs.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
