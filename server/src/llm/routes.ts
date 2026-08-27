import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireResourceSpace, requireSpace, rid } from '../lib/http.js';
import { PROVIDER_PRESETS, testProvider } from './router.js';
import { config } from '../config.js';

export async function llmRoutes(app: FastifyInstance) {
  app.get('/providers/presets', async () => ({ presets: PROVIDER_PRESETS }));

  app.get('/spaces/:spaceId/providers', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const rows = await q(
      `SELECT id, name, base_url, chat_model, embed_model, is_default, created_at FROM providers WHERE space_id = $1 ORDER BY created_at`,
      [spaceId]
    );
    // gatewayEnabled tells the UI whether the managed SET Cloud card can be offered
    return { providers: rows, gatewayEnabled: !!config.gatewayUrl };
  });

  // SET Cloud (PLAN.md Phase 5): enable the managed provider — issues a
  // gateway key and stores an ordinary provider row pointing at the LLM
  // gateway, so chat/embeddings routing, default selection and the test
  // button all work through the existing machinery. Metered per space;
  // caps live in settings.billing and are enforced by the gateway.
  app.post('/spaces/:spaceId/providers/platform', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'owner'))) return;
    if (!config.gatewayUrl) {
      return reply.code(400).send({ error: 'LLM gateway not configured on this server (GATEWAY_URL)' });
    }
    const body = z.object({ isDefault: z.boolean().optional(), chatModel: z.string().max(200).optional() }).parse(req.body ?? {});
    const existing = await one<{ id: string }>(
      `SELECT id FROM providers WHERE space_id = $1 AND name = 'SET Cloud (managed)'`,
      [spaceId]
    );
    if (existing) return reply.code(409).send({ error: 'SET Cloud is already enabled for this workspace' });
    const key = `sk-set-${randomBytes(24).toString('hex')}`;
    await one(`INSERT INTO gateway_keys (space_id, name, key) VALUES ($1, 'set-cloud', $2)`, [spaceId, key]);
    if (body.isDefault !== false) await q(`UPDATE providers SET is_default = false WHERE space_id = $1`, [spaceId]);
    const provider = await one<any>(
      `INSERT INTO providers (space_id, name, base_url, api_key, chat_model, is_default)
       VALUES ($1, 'SET Cloud (managed)', $2, $3, $4, $5)
       RETURNING id, name, base_url, chat_model, is_default`,
      [spaceId, config.gatewayUrl, key, body.chatModel ?? config.bootstrapLlm.chatModel ?? null, body.isDefault !== false]
    );
    return { provider };
  });

  // usage summary for the Settings dashboard: per-model totals + daily series
  // + the caps the gateway enforces. month = YYYY-MM (default: current).
  app.get('/spaces/:spaceId/usage', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const qm = String((req.query as any)?.month ?? '');
    const month = /^\d{4}-\d{2}$/.test(qm) ? qm : new Date().toISOString().slice(0, 7);
    const totals = await q(
      `SELECT kind, model, count(*)::int AS requests,
              COALESCE(SUM(prompt_tokens), 0)::int AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens,
              COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd
       FROM usage_events
       WHERE space_id = $1 AND created_at >= ($2 || '-01')::timestamptz
         AND created_at < ($2 || '-01')::timestamptz + interval '1 month'
       GROUP BY kind, model ORDER BY total_tokens DESC`,
      [spaceId, month]
    );
    const daily = await q(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
              COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd
       FROM usage_events
       WHERE space_id = $1 AND created_at >= ($2 || '-01')::timestamptz
         AND created_at < ($2 || '-01')::timestamptz + interval '1 month'
       GROUP BY 1 ORDER BY 1`,
      [spaceId, month]
    );
    const settings = await one<{ data: any }>(`SELECT data FROM settings WHERE space_id = $1`, [spaceId]);
    return { month, totals, daily, billing: settings?.data?.billing ?? {} };
  });

  app.post('/spaces/:spaceId/providers', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    const body = z
      .object({
        name: z.string().min(1),
        baseUrl: z.string().url(),
        apiKey: z.string().optional().nullable(),
        chatModel: z.string().optional().nullable(),
        embedModel: z.string().optional().nullable(),
        isDefault: z.boolean().optional(),
      })
      .parse(req.body);
    if (body.isDefault) await q(`UPDATE providers SET is_default = false WHERE space_id = $1`, [spaceId]);
    const provider = await one<any>(
      `INSERT INTO providers (space_id, name, base_url, api_key, chat_model, embed_model, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, base_url, chat_model, embed_model, is_default`,
      [spaceId, body.name, body.baseUrl, body.apiKey ?? null, body.chatModel ?? null, body.embedModel ?? null, body.isDefault ?? false]
    );
    return { provider };
  });

  app.patch('/providers/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'providers', id, 'editor');
    if (!ctx) return;
    const body = z
      .object({
        name: z.string().optional(),
        baseUrl: z.string().url().optional(),
        apiKey: z.string().nullable().optional(),
        chatModel: z.string().nullable().optional(),
        embedModel: z.string().nullable().optional(),
        isDefault: z.boolean().optional(),
      })
      .parse(req.body);
    if (body.isDefault) await q(`UPDATE providers SET is_default = false WHERE space_id = $1`, [ctx.spaceId]);
    const sets: string[] = [];
    const vals: any[] = [id];
    const map: Record<string, string> = {
      name: 'name', baseUrl: 'base_url', apiKey: 'api_key', chatModel: 'chat_model', embedModel: 'embed_model', isDefault: 'is_default',
    };
    for (const [k, col] of Object.entries(map)) {
      if ((body as any)[k] !== undefined) {
        vals.push((body as any)[k]);
        sets.push(`${col} = $${vals.length}`);
      }
    }
    if (sets.length) await q(`UPDATE providers SET ${sets.join(', ')} WHERE id = $1`, vals);
    return { ok: true };
  });

  app.delete('/providers/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'providers', id, 'editor');
    if (!ctx) return;
    // the SET Cloud provider's api_key IS a gateway key — revoke it too
    const p = await one<{ name: string; api_key: string | null }>(`SELECT name, api_key FROM providers WHERE id = $1`, [id]);
    if (p?.name === 'SET Cloud (managed)' && p.api_key) {
      await q(`UPDATE gateway_keys SET revoked_at = now() WHERE key = $1`, [p.api_key]);
    }
    await q(`DELETE FROM providers WHERE id = $1`, [id]);
    return { ok: true };
  });

  app.post('/providers/:id/test', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'providers', id);
    if (!ctx) return;
    const p = await one<{ base_url: string; api_key: string | null; chat_model: string | null }>(
      `SELECT base_url, api_key, chat_model FROM providers WHERE id = $1`,
      [id]
    );
    return testProvider(p!.base_url, p!.api_key, p!.chat_model);
  });

  app.post('/spaces/:spaceId/providers/test', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    const body = z.object({ baseUrl: z.string().url(), apiKey: z.string().optional().nullable(), model: z.string().optional().nullable() }).parse(req.body);
    return testProvider(body.baseUrl, body.apiKey ?? null, body.model ?? null);
  });
}
