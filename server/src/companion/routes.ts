import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireSpace } from '../lib/http.js';
import { config } from '../config.js';

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

/** How fresh a heartbeat must be for the companion to count as online
 *  (companion sends every ~45s; allow one missed beat). */
const HEALTH_ONLINE_MS = 90_000;

async function companionAuth(req: any, reply: any): Promise<{ spaceId: string; tokenId: string } | null> {
  const auth = req.headers?.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) {
    reply.code(401).send({ error: 'Pairing token required' });
    return null;
  }
  const row = await one<{ space_id: string; id: string }>(
    `SELECT id, space_id FROM companion_tokens WHERE token = $1 AND revoked_at IS NULL`,
    [token]
  );
  if (!row) {
    reply.code(401).send({ error: 'Invalid or revoked pairing token' });
    return null;
  }
  void q(`UPDATE companion_tokens SET last_used_at = now() WHERE id = $1`, [row.id]);
  return { spaceId: row.space_id, tokenId: row.id };
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
        kind: z.enum(['browser', 'native', 'cua']).optional(),
        app: z.string().max(200).optional(),      // native: app name / command
        element: z.string().max(200).optional(),  // native: "role:name" substring to point at
      })
      .parse(req.body);
    const task = await one<any>(
      `INSERT INTO teach_tasks (space_id, user_id, title, url, selector, message, kind, app, element)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [spaceId, req.user!.id, body.title, body.url ?? null, body.selector ?? null, body.message ?? null,
       body.kind ?? 'browser', body.app ?? null, body.element ?? null]
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
  // side-effect-free liveness probe for `companion.py --doctor` (must not
  // claim a task the way /companion/next would)
  app.get('/companion/ping', async (req, reply) => {
    const auth = await companionAuth(req, reply);
    if (!auth) return;
    return { ok: true, serverTime: new Date().toISOString() };
  });

  // periodic diagnostics from the user's machine (daemon, AT-SPI, input
  // permission) — shown live in Settings → Companion
  app.post('/companion/heartbeat', async (req, reply) => {
    const auth = await companionAuth(req, reply);
    if (!auth) return;
    const body = z.object({ health: z.record(z.string(), z.any()) }).parse(req.body ?? {});
    await q(`UPDATE companion_tokens SET health = $1, health_at = now() WHERE id = $2`, [
      JSON.stringify(body.health), auth.tokenId,
    ]);
    return { ok: true };
  });

  // user-facing health read: per-token live status for the Settings card
  app.get('/spaces/:spaceId/companion/health', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const rows = await q(
      `SELECT id, name, left(token, 8) AS token_prefix, created_at, last_used_at, revoked_at, health, health_at
       FROM companion_tokens WHERE space_id = $1 ORDER BY created_at DESC`,
      [spaceId]
    );
    return {
      companions: rows.map((r: any) => ({
        ...r,
        online: !r.revoked_at && !!r.health_at && Date.now() - new Date(r.health_at).getTime() < HEALTH_ONLINE_MS,
      })),
    };
  });

  // capture history: every persisted computer-use screenshot, newest first
  app.get('/spaces/:spaceId/companion/captures', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const limit = Math.min(Math.max(parseInt(String((req.query as any)?.limit ?? '60'), 10) || 60, 1), 200);
    const rows = await q(
      `SELECT id, file, action, window_title, window_id, width, height, created_at
       FROM captures WHERE space_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [spaceId, limit]
    );
    return { captures: rows.map((r: any) => ({ ...r, url: `/api/captures/${r.file}` })) };
  });

  app.delete('/spaces/:spaceId/companion/captures/:id', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'owner'))) return;
    const id = (req.params as any).id;
    const row = await one<{ file: string }>(`SELECT file FROM captures WHERE id = $1 AND space_id = $2`, [id, spaceId]);
    if (!row) return reply.code(404).send({ error: 'Capture not found' });
    await q(`DELETE FROM captures WHERE id = $1`, [id]);
    try {
      await unlink(join(config.dataDir, 'captures', row.file));
    } catch {
      // file already gone — the row delete above is what matters
    }
    return { ok: true };
  });

  app.get('/companion/next', async (req, reply) => {
    const auth = await companionAuth(req, reply);
    if (!auth) return;
    // claim oldest queued task (status-guarded = at-most-once per task)
    const task = await one<any>(
      `UPDATE teach_tasks SET status = 'running'
       WHERE id = (SELECT id FROM teach_tasks WHERE space_id = $1 AND status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
      [auth.spaceId]
    );
    return { task: task ?? null };
  });

  app.post('/companion/tasks/:id/result', async (req, reply) => {
    const auth = await companionAuth(req, reply);
    if (!auth) return;
    const id = (req.params as any).id;
    const body = z
      .object({
        status: z.enum(['done', 'error']),
        result: z.string().max(2000).optional(),
        // kind='cua' structured payload (annotated element summary, screenshot)
        result_data: z.any().optional(),
      })
      .parse(req.body);
    const row = await one<{ space_id: string }>(`SELECT space_id FROM teach_tasks WHERE id = $1`, [id]);
    if (!row || row.space_id !== auth.spaceId) return reply.code(404).send({ error: 'Task not found' });
    await q(
      `UPDATE teach_tasks SET status = $2, result = $3, result_data = $4, finished_at = now() WHERE id = $1`,
      [id, body.status, body.result ?? null, body.result_data ?? null]
    );
    return { ok: true };
  });
}
