import Fastify from 'fastify';
import { Pool } from 'pg';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * SET LLM gateway — PLAN.md Phase 5, step 1.
 *
 * A thin OpenAI-compatible proxy that sits between a SET space and the real
 * upstream model provider. Spaces authenticate with gateway keys issued by
 * the main server (Settings → AI Providers → SET Cloud); the gateway holds
 * the actual upstream key, meters every call into usage_events, and enforces
 * per-space spend caps (tokens and/or USD) plus a simple rate limit. BYOK
 * provider rows bypass this entirely — the gateway is opt-in per space.
 *
 * Deliberately stateless apart from Postgres: same DATABASE_URL as the main
 * server, so keys/settings/usage are shared and a restart loses nothing.
 */

const env = process.env;
const UPSTREAM_URL = (env.GATEWAY_UPSTREAM_URL || env.LLM_BASE_URL || '').replace(/\/$/, '');
const UPSTREAM_KEY = env.GATEWAY_UPSTREAM_KEY || env.LLM_API_KEY || '';
// {"model-substring": [prompt$per1M, completion$per1M]} — cost is only
// computed (and USD caps enforced) for models listed here.
const PRICES: Record<string, [number, number]> = (() => {
  try {
    return JSON.parse(env.GATEWAY_PRICES || '{}');
  } catch {
    console.error('[gateway] GATEWAY_PRICES is not valid JSON — running token-metering only');
    return {};
  }
})();
const RATE_LIMIT_PER_MIN = parseInt(env.GATEWAY_RATE_LIMIT_PER_MIN || '120', 10);

if (!UPSTREAM_URL) {
  console.error('[gateway] No upstream configured: set GATEWAY_UPSTREAM_URL (or LLM_BASE_URL)');
  process.exit(2);
}

const pool = new Pool({ connectionString: env.DATABASE_URL || 'postgres://set:set@localhost:5432/set' });

interface KeyCtx {
  keyId: string;
  spaceId: string;
}

async function authenticate(req: any, reply: any): Promise<KeyCtx | null> {
  const auth = req.headers?.authorization ?? '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!key) {
    reply.code(401).send({ error: 'Gateway key required (Settings → AI Providers → SET Cloud)' });
    return null;
  }
  const row = await pool.query<{ id: string; space_id: string }>(
    `SELECT id, space_id FROM gateway_keys WHERE key = $1 AND revoked_at IS NULL`,
    [key]
  );
  if (!row.rows.length) {
    reply.code(401).send({ error: 'Invalid or revoked gateway key' });
    return null;
  }
  void pool.query(`UPDATE gateway_keys SET last_used_at = now() WHERE id = $1`, [row.rows[0].id]);
  return { keyId: row.rows[0].id, spaceId: row.rows[0].space_id };
}

// per-space month-to-date spend + configured caps; the cap check runs before
// forwarding so an over-cap space fails fast without touching the upstream
async function capStatus(spaceId: string): Promise<{ tokens: number; usd: number; capTokens: number | null; capUsd: number | null }> {
  const usage = await pool.query(
    `SELECT COALESCE(SUM(total_tokens), 0)::bigint AS tokens, COALESCE(SUM(cost_usd), 0) AS usd
     FROM usage_events WHERE space_id = $1 AND created_at >= date_trunc('month', now())`,
    [spaceId]
  );
  const settings = await pool.query(
    `SELECT data->'billing' AS billing FROM settings WHERE space_id = $1`,
    [spaceId]
  );
  const billing = settings.rows[0]?.billing ?? {};
  const num = (v: any) => (typeof v === 'number' && v > 0 ? v : null);
  return {
    tokens: Number(usage.rows[0].tokens),
    usd: Number(usage.rows[0].usd),
    capTokens: num(billing?.capTokens),
    capUsd: num(billing?.capUsd),
  };
}

function checkCaps(caps: Awaited<ReturnType<typeof capStatus>>): { ok: true } | { ok: false; status: 429; body: any } {
  if (caps.capTokens !== null && caps.tokens >= caps.capTokens) {
    return { ok: false, status: 429, body: { error: `Monthly token cap reached (${caps.tokens}/${caps.capTokens}) — raise it in Settings → AI Providers`, reason: 'cap_tokens' } };
  }
  if (caps.capUsd !== null && caps.usd >= caps.capUsd) {
    return { ok: false, status: 429, body: { error: `Monthly spend cap reached ($${caps.usd.toFixed(2)}/$${caps.capUsd.toFixed(2)}) — raise it in Settings → AI Providers`, reason: 'cap_usd' } };
  }
  return { ok: true };
}

function priceFor(model: string): [number, number] | null {
  const m = model.toLowerCase();
  for (const [needle, price] of Object.entries(PRICES)) {
    if (m.includes(needle.toLowerCase())) return price;
  }
  return null;
}

function costUsd(model: string, promptTokens: number, completionTokens: number): number {
  const price = priceFor(model);
  if (!price) return 0;
  return Math.round(((promptTokens / 1e6) * price[0] + (completionTokens / 1e6) * price[1]) * 1e6) / 1e6;
}

async function recordUsage(spaceId: string, kind: 'chat' | 'embeddings', model: string, promptTokens: number, completionTokens: number, estimated: boolean): Promise<void> {
  const total = promptTokens + completionTokens;
  try {
    await pool.query(
      `INSERT INTO usage_events (space_id, kind, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, estimated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [spaceId, kind, model, promptTokens, completionTokens, total, costUsd(model, promptTokens, completionTokens), estimated]
    );
  } catch (e) {
    console.error('[gateway] usage insert failed:', e);
  }
}

// ~4 chars per token — only used when the upstream reports no usage
function estimateTokens(messages: any[]): number {
  const chars = messages.reduce((n, m) => n + (typeof m?.content === 'string' ? m.content.length : 0), 0);
  return Math.ceil(chars / 4);
}

// naive per-space sliding window (per gateway instance; fine for v1)
const rateBuckets = new Map<string, { windowStart: number; count: number }>();
function rateLimit(spaceId: string): boolean {
  const now = Date.now();
  let b = rateBuckets.get(spaceId);
  if (!b || now - b.windowStart > 60_000) {
    b = { windowStart: now, count: 0 };
    rateBuckets.set(spaceId, b);
  }
  b.count += 1;
  return b.count <= RATE_LIMIT_PER_MIN;
}

async function forward(req: any, path: string, body?: any): Promise<Response> {
  return fetch(`${UPSTREAM_URL}${path}`, {
    method: req.method,
    headers: {
      'content-type': 'application/json',
      ...(UPSTREAM_KEY ? { authorization: `Bearer ${UPSTREAM_KEY}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(300_000),
  });
}

const app = Fastify({ logger: true, bodyLimit: 64 * 1024 * 1024 });

app.get('/health', async () => ({ ok: true, name: 'set-gateway', upstream: UPSTREAM_URL }));

app.addHook('preHandler', async (req: any, reply: any) => {
  if (req.url === '/health') return;
  const ctx = await authenticate(req, reply);
  if (!ctx) return;
  if (!rateLimit(ctx.spaceId)) {
    return reply.code(429).send({ error: `Rate limit exceeded (${RATE_LIMIT_PER_MIN}/min)`, reason: 'rate_limit' });
  }
  (req as any).gateway = ctx;
});

app.get('/v1/models', async (req: any, reply: any) => {
  const res = await forward(req, '/models');
  reply.code(res.status).headers({ 'content-type': res.headers.get('content-type') ?? 'application/json' });
  return res.text();
});

app.post('/v1/embeddings', async (req: any, reply: any) => {
  const ctx = (req as any).gateway as KeyCtx;
  const caps = await capStatus(ctx.spaceId);
  const capErr = checkCaps(caps);
  if (!capErr.ok) return reply.code(capErr.status).send(capErr.body);

  const res = await forward(req, '/embeddings', req.body);
  if (!res.ok) {
    reply.code(res.status);
    return res.text();
  }
  const json: any = await res.json();
  const total = json.usage?.total_tokens ?? Math.ceil(JSON.stringify(req.body?.input ?? '').length / 4);
  await recordUsage(ctx.spaceId, 'embeddings', req.body?.model ?? '', 0, total, json.usage?.total_tokens === undefined);
  return json;
});

app.post('/v1/chat/completions', async (req: any, reply: any) => {
  const ctx = (req as any).gateway as KeyCtx;
  const caps = await capStatus(ctx.spaceId);
  const capErr = checkCaps(caps);
  if (!capErr.ok) return reply.code(capErr.status).send(capErr.body);

  const body = { ...req.body };
  const model: string = body.model ?? '';
  const streaming = body.stream === true;
  if (streaming) {
    // ask the upstream to include a usage chunk in the SSE tail so streamed
    // calls are metered exactly; without it we fall back to an estimate
    body.stream_options = { ...(body.stream_options ?? {}), include_usage: true };
  }

  const res = await forward(req, '/chat/completions', body);
  if (!res.ok) {
    reply.code(res.status);
    return res.text();
  }

  if (!streaming) {
    const json: any = await res.json();
    const usage = json.usage;
    const estimated = !usage?.prompt_tokens;
    const promptTokens = usage?.prompt_tokens ?? estimateTokens(body.messages ?? []);
    const completionTokens = usage?.completion_tokens ?? Math.ceil((json.choices?.[0]?.message?.content ?? '').length / 4);
    await recordUsage(ctx.spaceId, 'chat', model, promptTokens, completionTokens, estimated);
    return json;
  }

  // stream: pass every byte through untouched while scanning SSE lines for
  // the usage chunk and accumulating completion length for the estimate
  reply.hijack();
  reply.raw.writeHead(res.status, {
    'content-type': res.headers.get('content-type') ?? 'text/event-stream',
    'cache-control': 'no-cache',
  });
  let usage: any = null;
  let completionChars = 0;
  let sseBuffer = '';
  const scanner = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      if (!usage) {
        sseBuffer += chunk.toString('utf8');
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            if (json.usage) usage = json.usage;
            const delta = json.choices?.[0]?.delta?.content;
            if (typeof delta === 'string') completionChars += delta.length;
          } catch {
            /* partial line mid-chunk */
          }
        }
      }
      cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body as any), scanner, reply.raw);
  } catch (e) {
    console.error('[gateway] stream pipe failed:', e);
    reply.raw.end();
    return;
  }
  const estimated = !usage?.prompt_tokens;
  const promptTokens = usage?.prompt_tokens ?? estimateTokens(body.messages ?? []);
  const completionTokens = usage?.completion_tokens ?? Math.ceil(completionChars / 4);
  await recordUsage(ctx.spaceId, 'chat', model, promptTokens, completionTokens, estimated);
});

const port = parseInt(env.PORT || '4100', 10);
app.listen({ port, host: env.HOST || '0.0.0.0' }).then(() => {
  console.log(`[gateway] listening on :${port} → upstream ${UPSTREAM_URL}`);
});
