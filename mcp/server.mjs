#!/usr/bin/env node
// Crucix MCP Server — read-only stdio Model Context Protocol server exposing
// the running dashboard's sweep data to MCP-compatible agents/clients.
//
// Hand-rolled JSON-RPC 2.0 over stdio (newline-delimited JSON), matching the
// rest of this codebase's "raw fetch(), no SDKs" philosophy — no new npm
// dependency for this. See https://modelcontextprotocol.io for the spec this
// implements a minimal read-only subset of (initialize, tools/list, tools/call).
//
// This process is a thin proxy over the already-running dashboard server's
// HTTP API (/api/health, /api/data, /api/history) — it holds no state of its
// own and does not run sweeps. Point it at a non-default dashboard with
// CRUCIX_API_URL (defaults to http://localhost:<config.port>).
//
// Run directly:      node mcp/server.mjs
// Run via npm bin:    npx crucix-mcp   (after `npm link` or from this repo)
//
// CRITICAL: stdout carries ONLY JSON-RPC frames. All logging must go to
// stderr (console.error) — anything else on stdout corrupts the transport.

import { createInterface } from 'node:readline';
import config from '../crucix.config.mjs';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'crucix';
const SERVER_VERSION = '1.0.0';

const API_BASE = (process.env.CRUCIX_API_URL || `http://localhost:${config.port}`).replace(/\/$/, '');
const FETCH_TIMEOUT_MS = 10_000;

async function apiGet(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, { signal: controller.signal });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { rawText: text.slice(0, 500) }; }
    if (!res.ok) {
      throw new Error(`Crucix API ${path} returned HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    }
    return body;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Crucix API ${path} timed out after ${FETCH_TIMEOUT_MS / 1000}s — is the dashboard server running at ${API_BASE}?`);
    }
    if (err.cause?.code === 'ECONNREFUSED' || /ECONNREFUSED|fetch failed/.test(err.message)) {
      throw new Error(`Could not reach the Crucix dashboard at ${API_BASE} — start it with "npm run dev" first, or set CRUCIX_API_URL to point at a running instance.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Tool Definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'crucix_status',
    description: 'System health: uptime, last/next sweep time, source success/failure counts, LLM provider status. Wraps GET /api/health.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'crucix_brief',
    description: 'Compact plain-text intelligence brief: sweep direction, composite risk index, active cross-stream correlation, key market metrics (VIX/WTI/Brent/Gold/Silver), top urgent OSINT posts, and top AI-generated trade ideas (if an LLM is configured).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'crucix_data',
    description: 'Full current synthesized sweep data as JSON. Large (~100-300KB) — pass "sections" to request only specific top-level keys (e.g. ["riskIndex","delta","fred","acled"]) and keep the response small. Omit "sections" to get everything.',
    inputSchema: {
      type: 'object',
      properties: {
        sections: {
          type: 'array',
          items: { type: 'string' },
          description: 'Top-level keys to include (e.g. "riskIndex", "delta", "fred", "energy", "metals", "acled", "thermal", "air", "who", "tg", "news", "newsFeed", "ideas", "space", "health", "meta"). Omit for the full object.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'crucix_history',
    description: 'Recent sweep history (last N runs) with their computed deltas — direction, changes, cross-stream correlation, and composite risk index over time. Wraps GET /api/history.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 3, description: 'How many recent runs to return (max 3 — the size of the hot in-memory window). Default 3.' },
      },
      additionalProperties: false,
    },
  },
];

// ─── Tool Handlers ────────────────────────────────────────────────────────────

async function callTool(name, args = {}) {
  switch (name) {
    case 'crucix_status': {
      const health = await apiGet('/api/health');
      return jsonResult(health);
    }

    case 'crucix_brief': {
      const data = await apiGet('/api/data');
      return textResult(buildBriefText(data));
    }

    case 'crucix_data': {
      const data = await apiGet('/api/data');
      if (Array.isArray(args.sections) && args.sections.length > 0) {
        const picked = {};
        for (const key of args.sections) {
          if (key in data) picked[key] = data[key];
        }
        return jsonResult(picked);
      }
      return jsonResult(data);
    }

    case 'crucix_history': {
      const limit = Number.isInteger(args.limit) ? args.limit : 3;
      const history = await apiGet(`/api/history?limit=${encodeURIComponent(limit)}`);
      return jsonResult(history);
    }

    default:
      throw new McpToolError(`Unknown tool: ${name}`);
  }
}

class McpToolError extends Error {}

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function jsonResult(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

function buildBriefText(data) {
  const lines = [`CRUCIX BRIEF — ${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC`, ''];

  const delta = data.delta;
  if (delta?.summary) {
    lines.push(`Direction: ${delta.summary.direction.toUpperCase()} | ${delta.summary.totalChanges} changes, ${delta.summary.criticalChanges} critical`);
  }

  const risk = data.riskIndex;
  if (risk) {
    lines.push(`Risk Index: ${risk.score}/100 (${risk.level.toUpperCase()})`);
  }
  if (delta?.correlation?.active) {
    lines.push(`Cross-Stream Correlation: ${delta.correlation.severity.toUpperCase()} — ${delta.correlation.domainsTriggered.join(', ')}`);
  }
  lines.push('');

  const vix = data.fred?.find(f => f.id === 'VIXCLS');
  const hy = data.fred?.find(f => f.id === 'BAMLH0A0HYM2');
  const energy = data.energy || {};
  const metals = data.metals || {};
  if (vix || energy.wti || metals.gold) {
    lines.push(`VIX: ${vix?.value ?? '--'} | WTI: $${energy.wti ?? '--'} | Brent: $${energy.brent ?? '--'}`);
    lines.push(`Gold: $${metals.gold ?? '--'} | Silver: $${metals.silver ?? '--'}${hy ? ` | HY Spread: ${hy.value}` : ''}`);
    lines.push('');
  }

  const urgent = data.tg?.urgent || [];
  if (urgent.length) {
    lines.push(`OSINT: ${urgent.length} urgent signals, ${data.tg?.posts ?? 0} total posts`);
    for (const p of urgent.slice(0, 3)) {
      lines.push(`  - ${(p.text || '').substring(0, 100)}`);
    }
    lines.push('');
  }

  const ideas = (data.ideas || []).slice(0, 5);
  if (ideas.length) {
    lines.push(`Top Ideas (${data.ideasSource || 'unknown'}):`);
    for (const idea of ideas) {
      lines.push(`  [${idea.type}] ${idea.title} (${idea.confidence})`);
    }
  }

  return lines.join('\n');
}

// ─── JSON-RPC / stdio Transport ──────────────────────────────────────────────

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleMessage(msg) {
  const { id, method, params } = msg;

  // Notifications (no id) never get a response, even on error.
  const isNotification = id === undefined;

  try {
    switch (method) {
      case 'initialize':
        sendResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        });
        return;

      case 'notifications/initialized':
      case 'notifications/cancelled':
        return; // nothing to do, no response for notifications

      case 'ping':
        if (!isNotification) sendResult(id, {});
        return;

      case 'tools/list':
        sendResult(id, { tools: TOOLS });
        return;

      case 'tools/call': {
        const { name, arguments: args } = params || {};
        try {
          const result = await callTool(name, args);
          sendResult(id, result);
        } catch (err) {
          // Tool-level failures (bad args, unreachable dashboard) are reported
          // as a tool result with isError, not a protocol-level error — this
          // lets the calling agent see and react to the message.
          sendResult(id, { content: [{ type: 'text', text: err.message }], isError: true });
        }
        return;
      }

      default:
        if (!isNotification) sendError(id, -32601, `Method not found: ${method}`);
        return;
    }
  } catch (err) {
    console.error('[crucix-mcp] Unhandled error handling', method, err);
    if (!isNotification) sendError(id, -32603, err.message || 'Internal error');
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    sendError(null, -32700, 'Parse error');
    return;
  }
  handleMessage(msg);
});

process.stdin.on('end', () => process.exit(0));

console.error(`[crucix-mcp] Ready — proxying ${API_BASE}`);
