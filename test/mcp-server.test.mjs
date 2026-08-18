// Crucix MCP server — integration test over the real stdio JSON-RPC transport.
// Spawns mcp/server.mjs as a child process and talks to it exactly as a real
// MCP client would, against a stub HTTP server standing in for the dashboard
// (no live dashboard/network dependency — same "mock the network" convention
// as the LLM provider unit tests). Uses Node's built-in test runner.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, '..', 'mcp', 'server.mjs');

const STUB_HEALTH = { status: 'ok', uptime: 123, lastSweep: '2026-08-18T00:00:00Z', sourcesOk: 27, sourcesFailed: 2 };
const STUB_DATA = {
  meta: { sourcesOk: 27, sourcesQueried: 29 },
  riskIndex: { score: 42, level: 'elevated', domains: { market: 40 }, components: [] },
  delta: { summary: { direction: 'risk-off', totalChanges: 3, criticalChanges: 1 }, correlation: { active: true, severity: 'high', domainsTriggered: ['market', 'conflict'] } },
  fred: [{ id: 'VIXCLS', value: 22.1 }, { id: 'BAMLH0A0HYM2', value: 4.2 }],
  energy: { wti: 70.1, brent: 74.2 },
  metals: { gold: 2400, silver: 30 },
  tg: { posts: 100, urgent: [{ text: 'urgent signal one' }, { text: 'urgent signal two' }] },
  ideas: [{ type: 'LONG', title: 'Long gold on risk-off', confidence: 'HIGH' }],
  ideasSource: 'llm',
};
const STUB_HISTORY = { runs: [{ timestamp: '2026-08-18T00:00:00Z', delta: { summary: { direction: 'mixed' } } }] };

let stub;
let stubUrl;

before(async () => {
  stub = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/health')) return res.end(JSON.stringify(STUB_HEALTH));
    if (req.url.startsWith('/api/data')) return res.end(JSON.stringify(STUB_DATA));
    if (req.url.startsWith('/api/history')) return res.end(JSON.stringify(STUB_HISTORY));
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  stubUrl = `http://127.0.0.1:${stub.address().port}`;
});

after(async () => {
  await new Promise(resolve => stub.close(resolve));
});

/** Spawn an mcp/server.mjs instance and return helpers to talk JSON-RPC to it. */
function spawnMcp(apiUrl) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, CRUCIX_API_URL: apiUrl },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const pending = new Map();
  let nextId = 1;

  rl.on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });

  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for response to ${method}`)), 5000);
      pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  function close() {
    child.stdin.end();
    child.kill();
  }

  return { child, request, notify, close };
}

describe('crucix MCP server', () => {
  it('completes the initialize handshake', async () => {
    const mcp = spawnMcp(stubUrl);
    try {
      const res = await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
      assert.equal(res.result.serverInfo.name, 'crucix');
      assert.ok(res.result.capabilities.tools);
      mcp.notify('notifications/initialized');
    } finally {
      mcp.close();
    }
  });

  it('lists all four tools with schemas', async () => {
    const mcp = spawnMcp(stubUrl);
    try {
      const res = await mcp.request('tools/list', {});
      const names = res.result.tools.map(t => t.name).sort();
      assert.deepEqual(names, ['crucix_brief', 'crucix_data', 'crucix_history', 'crucix_status']);
      for (const tool of res.result.tools) {
        assert.equal(tool.inputSchema.type, 'object');
      }
    } finally {
      mcp.close();
    }
  });

  it('crucix_status proxies GET /api/health', async () => {
    const mcp = spawnMcp(stubUrl);
    try {
      const res = await mcp.request('tools/call', { name: 'crucix_status', arguments: {} });
      const parsed = JSON.parse(res.result.content[0].text);
      assert.equal(parsed.uptime, 123);
      assert.equal(parsed.sourcesOk, 27);
    } finally {
      mcp.close();
    }
  });

  it('crucix_brief renders a compact plain-text summary with risk + correlation', async () => {
    const mcp = spawnMcp(stubUrl);
    try {
      const res = await mcp.request('tools/call', { name: 'crucix_brief', arguments: {} });
      const text = res.result.content[0].text;
      assert.match(text, /RISK-OFF/);
      assert.match(text, /Risk Index: 42\/100 \(ELEVATED\)/);
      assert.match(text, /Cross-Stream Correlation: HIGH — market, conflict/);
      assert.match(text, /VIX: 22\.1/);
      assert.match(text, /urgent signal one/);
      assert.match(text, /Long gold on risk-off/);
    } finally {
      mcp.close();
    }
  });

  it('crucix_data returns the full object by default', async () => {
    const mcp = spawnMcp(stubUrl);
    try {
      const res = await mcp.request('tools/call', { name: 'crucix_data', arguments: {} });
      const parsed = JSON.parse(res.result.content[0].text);
      assert.equal(parsed.riskIndex.score, 42);
      assert.ok(parsed.fred);
      assert.ok(parsed.tg);
    } finally {
      mcp.close();
    }
  });

  it('crucix_data filters to requested sections only', async () => {
    const mcp = spawnMcp(stubUrl);
    try {
      const res = await mcp.request('tools/call', { name: 'crucix_data', arguments: { sections: ['riskIndex', 'energy'] } });
      const parsed = JSON.parse(res.result.content[0].text);
      assert.deepEqual(Object.keys(parsed).sort(), ['energy', 'riskIndex']);
    } finally {
      mcp.close();
    }
  });

  it('crucix_history proxies GET /api/history', async () => {
    const mcp = spawnMcp(stubUrl);
    try {
      const res = await mcp.request('tools/call', { name: 'crucix_history', arguments: { limit: 1 } });
      const parsed = JSON.parse(res.result.content[0].text);
      assert.equal(parsed.runs.length, 1);
    } finally {
      mcp.close();
    }
  });

  it('reports unknown tool names as a tool error, not a protocol crash', async () => {
    const mcp = spawnMcp(stubUrl);
    try {
      const res = await mcp.request('tools/call', { name: 'not_a_real_tool', arguments: {} });
      assert.equal(res.result.isError, true);
      assert.match(res.result.content[0].text, /Unknown tool/);
    } finally {
      mcp.close();
    }
  });

  it('reports unknown methods as a JSON-RPC error', async () => {
    const mcp = spawnMcp(stubUrl);
    try {
      const res = await mcp.request('not/a/real/method', {});
      assert.equal(res.error.code, -32601);
    } finally {
      mcp.close();
    }
  });

  it('degrades gracefully when the dashboard is unreachable', async () => {
    // Port 1 is a privileged, essentially always-closed port — connection refused.
    const mcp = spawnMcp('http://127.0.0.1:1');
    try {
      const res = await mcp.request('tools/call', { name: 'crucix_status', arguments: {} });
      assert.equal(res.result.isError, true);
      assert.match(res.result.content[0].text, /Crucix dashboard/);
    } finally {
      mcp.close();
    }
  });
});
