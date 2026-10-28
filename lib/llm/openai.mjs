// OpenAI Provider — raw fetch, no SDK
//
// baseUrl (OPENAI_BASE_URL) lets this point at any OpenAI-compatible server
// instead of the real OpenAI API — llama.cpp's llama-server, vLLM's API
// server, LM Studio, etc. all implement the same /v1/chat/completions shape.

import { LLMProvider } from './provider.mjs';

const OPENAI_API_URL = 'https://api.openai.com';

export class OpenAIProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'openai';
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-5.4';
    this.baseUrl = (config.baseUrl || OPENAI_API_URL).replace(/\/+$/, '');
    this.isLocal = this.baseUrl !== OPENAI_API_URL;
  }

  // Self-hosted OpenAI-compatible servers typically don't enforce an API
  // key — only require one when actually targeting the real OpenAI API.
  get isConfigured() { return this.isLocal ? !!this.model : !!this.apiKey; }

  async complete(systemPrompt, userMessage, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        // Real OpenAI deprecated max_tokens in favor of max_completion_tokens
        // for newer (reasoning-capable) models; self-hosted OpenAI-compatible
        // servers (llama.cpp, vLLM) follow the older, more universally
        // supported max_tokens convention.
        [this.isLocal ? 'max_tokens' : 'max_completion_tokens']: opts.maxTokens || 4096,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(opts.timeout || 60000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`OpenAI API ${res.status}: ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';

    return {
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      model: data.model || this.model,
    };
  }
}
