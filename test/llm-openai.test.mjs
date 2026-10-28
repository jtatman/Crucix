// OpenAI provider — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider } from '../lib/llm/openai.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';

describe('OpenAIProvider', () => {
  it('defaults to the real OpenAI API and requires an API key', () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    assert.equal(provider.baseUrl, 'https://api.openai.com');
    assert.equal(provider.isLocal, false);
    assert.equal(provider.isConfigured, true);
  });

  it('is not configured without an API key when targeting the real API', () => {
    const provider = new OpenAIProvider({});
    assert.equal(provider.isConfigured, false);
  });

  it('treats a custom baseUrl as local and does not require an API key', () => {
    const provider = new OpenAIProvider({ baseUrl: 'http://localhost:9931', model: 'local-model' });
    assert.equal(provider.isLocal, true);
    assert.equal(provider.isConfigured, true); // model is set, no key needed
  });

  it('still has a usable default model locally, matching the other providers\' pattern', () => {
    const provider = new OpenAIProvider({ baseUrl: 'http://localhost:9931' });
    assert.equal(provider.model, 'gpt-5.4');
    assert.equal(provider.isConfigured, true);
  });

  it('strips a trailing slash from a custom baseUrl', () => {
    const provider = new OpenAIProvider({ baseUrl: 'http://localhost:9931/' });
    assert.equal(provider.baseUrl, 'http://localhost:9931');
  });

  it('hits the custom baseUrl, not api.openai.com, when one is set', async () => {
    const provider = new OpenAIProvider({ baseUrl: 'http://localhost:9931', model: 'local-model' });
    const originalFetch = globalThis.fetch;
    let calledUrl;
    globalThis.fetch = mock.fn((url) => {
      calledUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'hi' } }], model: 'local-model' }),
      });
    });
    try {
      await provider.complete('sys', 'user');
      assert.equal(calledUrl, 'http://localhost:9931/v1/chat/completions');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses max_tokens for a local server and max_completion_tokens for the real API', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody;
    globalThis.fetch = mock.fn((url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'hi' } }] }),
      });
    });
    try {
      const local = new OpenAIProvider({ baseUrl: 'http://localhost:9931', model: 'local-model' });
      await local.complete('sys', 'user');
      assert.ok('max_tokens' in capturedBody);
      assert.ok(!('max_completion_tokens' in capturedBody));

      const real = new OpenAIProvider({ apiKey: 'sk-test' });
      await real.complete('sys', 'user');
      assert.ok('max_completion_tokens' in capturedBody);
      assert.ok(!('max_tokens' in capturedBody));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('omits the Authorization header when no API key is set (local, keyless)', async () => {
    const provider = new OpenAIProvider({ baseUrl: 'http://localhost:9931', model: 'local-model' });
    const originalFetch = globalThis.fetch;
    let capturedHeaders;
    globalThis.fetch = mock.fn((url, opts) => {
      capturedHeaders = opts.headers;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ choices: [{ message: { content: 'hi' } }] }) });
    });
    try {
      await provider.complete('sys', 'user');
      assert.equal(capturedHeaders.Authorization, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws on API error', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('Unauthorized') })
    );
    try {
      await assert.rejects(() => provider.complete('sys', 'user'), /OpenAI API 401/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('createLLMProvider — openai', () => {
  it('passes baseUrl through to the OpenAIProvider', () => {
    const provider = createLLMProvider({ provider: 'openai', apiKey: null, model: 'local-model', baseUrl: 'http://localhost:9931' });
    assert.equal(provider.baseUrl, 'http://localhost:9931');
    assert.equal(provider.isLocal, true);
    assert.equal(provider.isConfigured, true);
  });

  it('defaults to the real API when no baseUrl is configured', () => {
    const provider = createLLMProvider({ provider: 'openai', apiKey: 'sk-test', model: null, baseUrl: null });
    assert.equal(provider.baseUrl, 'https://api.openai.com');
    assert.equal(provider.isLocal, false);
  });
});
