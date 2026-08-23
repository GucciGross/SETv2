import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireResourceSpace, requireSpace, rid } from '../lib/http.js';
import { PROVIDER_PRESETS, testProvider } from './router.js';

export async function llmRoutes(app: FastifyInstance) {
  app.get('/providers/presets', async () => ({ presets: PROVIDER_PRESETS }));

  app.get('/spaces/:spaceId/providers', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const rows = await q(
      `SELECT id, name, base_url, chat_model, embed_model, is_default, created_at FROM providers WHERE space_id = $1 ORDER BY created_at`,
      [spaceId]
    );
    return { providers: rows };
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
