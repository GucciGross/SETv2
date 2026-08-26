import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireSpace } from '../lib/http.js';

/**
 * Phase 2 — show-me teaching companion (PLAN.md).
 *
 * Two halves:
 *  - User API (JWT): create/revoke pairing tokens, queue teach tasks.
 *  - Companion API (pairing token): the local agent on the user's machine
 *    claims the next queued task and reports the result. Tasks are strictly
 *    visible actions (open a page, highlight an element, show a caption) —
 *    nothing runs headless, nothing acts without the user watching.
 */

async function companionAuth(req: any, reply: any): Promise<string | null> {
  const auth = req.headers?.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) {
    reply.code(401).send({ error: 'Pairing token required' });
    return null;
  }
  const row = await one<{ space_id: string }>(
    `SELECT space_id FROM companion_tokens WHERE token = $1 AND revoked_at IS NULL`,
    [token]
  );
  if (!row) {
    reply.code(401).send({ error: 'Invalid or revoked pairing token' });
    return null;
  }
  void q(`UPDATE companion_tokens SET last_used_at = now() WHERE token = $1`, [token]);
  return row.space_id;
}

export async function companionRoutes(app: FastifyInstance) {
  // ---- user API ---------------------------------------------------------
  app.get('/spaces/:spaceId/companion/tokens', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'owner'))) return;
    const rows = await q(
      `SELECT id, name, left(token, 8) AS token_prefix, created_at, last_used_at, revoked_at
       FROM companion_tokens WHERE space_id = $1 ORDER BY created_at DESC`,
      [spaceId]
    );
    return { tokens: rows };
  });

  app.post('/spaces/:spaceId/companion/tokens', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'owner'))) return;
    const body = z.object({ name: z.string().max(60).optional() }).parse(req.body ?? {});
    const token = randomBytes(24).toString('hex');
    const row = await one<any>(
      `INSERT INTO companion_tokens (space_id, name, token) VALUES ($1, $2, $3)
       RETURNING id, name, token, created_at`,
      [spaceId, body.name ?? 'companion', token]
    );
    return { token: row };
  });

  app.delete('/companion/tokens/:id', async (req, reply) => {
    const id = (req.params as any).id;
    const row = await one<{ space_id: string }>(`SELECT space_id FROM companion_tokens WHERE id = $1`, [id]);
    if (!row) return reply.code(404).send({ error: 'Token not found' });
    if (!(await requireSpace(req, reply, row.space_id, 'owner'))) return;
    await q(`UPDATE companion_tokens SET revoked_at = now() WHERE id = $1`, [id]);
    return { ok: true };
  });

  app.post('/spaces/:spaceId/teach', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    const body = z
      .object({
        title: z.string().min(1).max(200),
        url: z.string().max(500).optional(),
        selector: z.string().max(300).optional(),
        message: z.string().max(1000).optional(),
      })
      .parse(req.body);
    const task = await one<any>(
      `INSERT INTO teach_tasks (space_id, user_id, title, url, selector, message)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [spaceId, req.user!.id, body.title, body.url ?? null, body.selector ?? null, body.message ?? null]
    );
    return { task };
  });

  app.get('/spaces/:spaceId/teach', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const rows = await q(
      `SELECT * FROM teach_tasks WHERE space_id = $1 ORDER BY created_at DESC LIMIT 25`,
      [spaceId]
    );
    return { tasks: rows };
  });

  // ---- companion API (pairing-token auth) --------------------------------
  app.get('/companion/next', async (req, reply) => {
    const spaceId = await companionAuth(req, reply);
    if (!spaceId) return;
    // claim oldest queued task (status-guarded = at-most-once per task)
    const task = await one<any>(
      `UPDATE teach_tasks SET status = 'running'
       WHERE id = (SELECT id FROM teach_tasks WHERE space_id = $1 AND status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
      [spaceId]
    );
    return { task: task ?? null };
  });

  app.post('/companion/tasks/:id/result', async (req, reply) => {
    const spaceId = await companionAuth(req, reply);
    if (!spaceId) return;
    const id = (req.params as any).id;
    const body = z
      .object({ status: z.enum(['done', 'error']), result: z.string().max(2000).optional() })
      .parse(req.body);
    const row = await one<{ space_id: string }>(`SELECT space_id FROM teach_tasks WHERE id = $1`, [id]);
    if (!row || row.space_id !== spaceId) return reply.code(404).send({ error: 'Task not found' });
    await q(
      `UPDATE teach_tasks SET status = $2, result = $3, finished_at = now() WHERE id = $1`,
      [id, body.status, body.result ?? null]
    );
    return { ok: true };
  });
}
