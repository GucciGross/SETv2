import { one } from '../db.js';
import { config, HASH_EMBED_DIM } from '../config.js';

export interface Provider {
  id: string;
  space_id: string;
  name: string;
  base_url: string;
  api_key: string | null;
  chat_model: string | null;
  embed_model: string | null;
  is_default: boolean;
}

export const PROVIDER_PRESETS = [
  { name: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', chatModel: 'llama3.1', embedModel: 'nomic-embed-text' },
  { name: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', chatModel: 'local-model', embedModel: 'text-embedding-nomic-embed-text-v1.5' },
  { name: 'vLLM', baseUrl: 'http://localhost:8000/v1', chatModel: 'meta-llama/Llama-3.1-8B-Instruct', embedModel: null },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', chatModel: 'gpt-4o-mini', embedModel: 'text-embedding-3-small' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', chatModel: 'openai/gpt-4o-mini', embedModel: 'openai/text-embedding-3-small' },
  { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', chatModel: 'llama-3.3-70b-versatile', embedModel: null },
];

export async function getProvider(spaceId: string, providerId?: string | null): Promise<Provider | null> {
  if (providerId) {
    const p = await one<Provider>(`SELECT * FROM providers WHERE id = $1 AND space_id = $2`, [providerId, spaceId]);
    if (p) return p;
  }
  const def = await one<Provider>(`SELECT * FROM providers WHERE space_id = $1 AND is_default`, [spaceId]);
  if (def) return def;
  const any = await one<Provider>(`SELECT * FROM providers WHERE space_id = $1 ORDER BY created_at LIMIT 1`, [spaceId]);
  return any ?? null;
}

/** Bootstrap provider from env (applied once per space on first use). */
export async function ensureBootstrapProvider(spaceId: string) {
  const b = config.bootstrapLlm;
  if (!b.baseUrl) return;
  const exists = await one(`SELECT id FROM providers WHERE space_id = $1 LIMIT 1`, [spaceId]);
  if (!exists) {
    await one(
      `INSERT INTO providers (space_id, name, base_url, api_key, chat_model, embed_model, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [spaceId, 'Default (env)', b.baseUrl, b.apiKey ?? null, b.chatModel ?? null, b.embedModel ?? null]
    );
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: any };
}

interface ChatOpts {
  messages: ChatMessage[];
  tools?: ToolDef[];
  temperature?: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string | null;
  tool_calls: any[];
  raw: any;
}

export async function chatCompletion(p: Provider, model: string | null, opts: ChatOpts): Promise<ChatResult> {
  const res = await fetch(`${p.base_url.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(p.api_key ? { authorization: `Bearer ${p.api_key}` } : {}),
    },
    body: JSON.stringify({
      model: model ?? p.chat_model ?? 'gpt-4o-mini',
      messages: opts.messages,
      ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}),
      temperature: opts.temperature ?? 0.4,
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM error ${res.status}: ${text.slice(0, 400)}`);
  }
  const json: any = await res.json();
  const choice = json.choices?.[0]?.message ?? {};
  return { content: choice.content ?? null, tool_calls: choice.tool_calls ?? [], raw: json };
}

/** Streamed chat — yields content deltas and tool_calls. */
export async function chatCompletionStream(
  p: Provider,
  model: string | null,
  opts: ChatOpts,
  onDelta: (text: string) => void
): Promise<ChatResult> {
  const res = await fetch(`${p.base_url.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(p.api_key ? { authorization: `Bearer ${p.api_key}` } : {}),
    },
    body: JSON.stringify({
      model: model ?? p.chat_model ?? 'gpt-4o-mini',
      messages: opts.messages,
      ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}),
      temperature: opts.temperature ?? 0.4,
      stream: true,
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM error ${res.status}: ${text.slice(0, 400)}`);
  }
  if (!res.body) throw new Error('Empty LLM stream');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCallsMap = new Map<number, { id: string; name: string; args: string }>();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          content += delta.content;
          onDelta(delta.content);
        }
        for (const tc of delta.tool_calls ?? []) {
          const existing = toolCallsMap.get(tc.index) ?? { id: '', name: '', args: '' };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name += tc.function.name;
          if (tc.function?.arguments) existing.args += tc.function.arguments;
          toolCallsMap.set(tc.index, existing);
        }
      } catch {
        /* skip malformed chunk */
      }
    }
  }
  const tool_calls = [...toolCallsMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([_, tc]) => ({
      id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
      type: 'function',
      function: { name: tc.name, arguments: tc.args },
    }));
  return { content: content || null, tool_calls, raw: {} };
}

/**
 * Deterministic hashed bag-of-words embedding — lets semantic search work with
 * zero LLM configured. Replaced by real provider embeddings when available.
 */
export function hashEmbed(text: string, dim = HASH_EMBED_DIM): number[] {
  const vec = new Array(dim).fill(0);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  for (const w of words) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) {
      h ^= w.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dim;
    vec[idx] += 1;
    // bigram-ish smoothing
    const idx2 = Math.abs(Math.imul(h, 31)) % dim;
    vec[idx2] += 0.5;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export async function embedTexts(p: Provider | null, texts: string[]): Promise<{ vectors: number[][]; dim: number; model: string }> {
  if (!p?.embed_model) {
    return { vectors: texts.map((t) => hashEmbed(t)), dim: HASH_EMBED_DIM, model: 'builtin-hash' };
  }
  const res = await fetch(`${p.base_url.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(p.api_key ? { authorization: `Bearer ${p.api_key}` } : {}),
    },
    body: JSON.stringify({ model: p.embed_model, input: texts }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Embedding error ${res.status}: ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const vectors: number[][] = json.data.map((d: any) => d.embedding as number[]);
  return { vectors, dim: vectors[0]?.length ?? HASH_EMBED_DIM, model: p.embed_model };
}

export async function testProvider(baseUrl: string, apiKey: string | null, model: string | null): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model: model ?? 'gpt-4o-mini', messages: [{ role: 'user', content: 'Reply with the single word: ok' }], max_tokens: 5 }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const json: any = await res.json();
    return { ok: true, detail: json.choices?.[0]?.message?.content ?? 'connected' };
  } catch (e: any) {
    return { ok: false, detail: e.message ?? String(e) };
  }
}
