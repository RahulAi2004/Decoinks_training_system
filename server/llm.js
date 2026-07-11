// Provider-agnostic LLM layer: Anthropic + OpenAI via plain fetch, plus a deterministic
// 'mock' fallback so the whole app runs with no API key.
import 'dotenv/config';
import { getSetting } from './db.js';

const ANTHROPIC_DEFAULT = 'claude-sonnet-5';
const OPENAI_DEFAULT = 'gpt-4o-mini';
const GROQ_DEFAULT = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const DEFAULT_MODEL = { anthropic: ANTHROPIC_DEFAULT, openai: OPENAI_DEFAULT, groq: GROQ_DEFAULT };
const SUPPORTED_PROVIDERS = new Set(['auto', 'anthropic', 'openai', 'groq', 'mock']);

export function resolveProvider() {
  const stored = getSetting('llm');
  const cfg = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  const requested = String(cfg.provider || 'auto').toLowerCase().trim();
  // A corrupted/old setting must never silently turn into an authenticated
  // OpenAI request via the generic OpenAI-compatible branch below.
  let provider = SUPPORTED_PROVIDERS.has(requested) ? requested : 'mock';
  if (provider === 'auto') {
    // Groq is preferred over OpenAI in auto-detect (free tier, and OpenAI keys here
    // may lack quota). Anthropic still wins if its key is set.
    if (process.env.ANTHROPIC_API_KEY) provider = 'anthropic';
    else if (process.env.GROQ_API_KEY) provider = 'groq';
    else if (process.env.OPENAI_API_KEY) provider = 'openai';
    else provider = 'mock';
  }
  if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) provider = 'mock';
  if (provider === 'groq' && !process.env.GROQ_API_KEY) provider = 'mock';
  if (provider === 'openai' && !process.env.OPENAI_API_KEY) provider = 'mock';
  // A model entered for one provider is not portable to a provider selected by
  // auto-detection. Explicit provider selections may still use custom models.
  const customModel = requested !== 'auto' && requested === provider ? String(cfg.model || '').trim() : '';
  const model = customModel || DEFAULT_MODEL[provider] || OPENAI_DEFAULT;
  return { provider, model };
}

async function fetchJson(url, opts, timeoutMs = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`LLM API ${res.status}: ${JSON.stringify(data).slice(0, 400)}`);
    return data;
  } finally { clearTimeout(t); }
}

// messages: [{role:'user'|'assistant', content}], returns plain text
export async function completeText({ system, messages, maxTokens = 800 }) {
  const { provider, model } = resolveProvider();
  if (provider === 'mock') return null;   // callers provide their own fallback

  if (provider === 'anthropic') {
    const data = await fetchJson('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
    });
    return data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') ?? '';
  }

  // OpenAI and Groq share the same chat-completions request shape.
  const url = provider === 'groq' ? GROQ_URL : 'https://api.openai.com/v1/chat/completions';
  const apiKey = provider === 'groq' ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;
  const data = await fetchJson(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: maxTokens,
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
    }),
  });
  return data.choices?.[0]?.message?.content ?? '';
}

// Structured output. schema = JSON Schema object. Returns parsed object or null (mock).
export async function completeJSON({ system, messages, schema, schemaName = 'result', maxTokens = 1500 }) {
  const { provider, model } = resolveProvider();
  if (provider === 'mock') return null;

  if (provider === 'anthropic') {
    // Force a tool call so the response is schema-validated JSON.
    const data = await fetchJson('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model, max_tokens: maxTokens, system, messages,
        tools: [{ name: schemaName, description: 'Return the structured result.', input_schema: schema }],
        tool_choice: { type: 'tool', name: schemaName },
      }),
    });
    const block = data.content?.find(b => b.type === 'tool_use');
    return block ? block.input : null;
  }

  if (provider === 'groq') {
    // Groq is OpenAI-compatible but supports json_object mode (not full json_schema).
    // Embed the schema in the system prompt so the output conforms.
    const sys = `${system || ''}\n\nRespond with ONLY a single JSON object that conforms to this JSON Schema (no prose, no markdown fences):\n${JSON.stringify(schema)}`.trim();
    const data = await fetchJson(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: maxTokens,
        messages: [{ role: 'system', content: sys }, ...messages],
        response_format: { type: 'json_object' },
      }),
    });
    const text = data.choices?.[0]?.message?.content ?? '{}';
    try { return JSON.parse(text); } catch { return null; }
  }

  const data = await fetchJson('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: maxTokens,
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
      response_format: { type: 'json_schema', json_schema: { name: schemaName, schema, strict: false } },
    }),
  });
  const text = data.choices?.[0]?.message?.content ?? '{}';
  try { return JSON.parse(text); } catch { return null; }
}

export function activeModelLabel() {
  const { provider, model } = resolveProvider();
  return provider === 'mock' ? 'mock (no API key — heuristic scoring)' : `${provider}/${model}`;
}
