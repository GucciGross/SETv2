import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireSpace, requireUser } from '../lib/http.js';
import { recordActivity } from '../team/activity.js';

export async function spaceRoutes(app: FastifyInstance) {
  app.get('/spaces', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const rows = await q(
      `SELECT s.*, m.role FROM spaces s JOIN memberships m ON m.space_id = s.id
       WHERE m.user_id = $1 ORDER BY s.created_at`,
      [user.id]
    );
    return { spaces: rows };
  });

  app.post('/spaces', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const body = z.object({ name: z.string().min(1).max(120), icon: z.string().optional() }).parse(req.body);
    const space = await one(
      `INSERT INTO spaces (name, kind, icon, owner_id) VALUES ($1, 'team', $2, $3) RETURNING *`,
      [body.name, body.icon ?? '', user.id]
    );
    await q(`INSERT INTO memberships (user_id, space_id, role) VALUES ($1, $2, 'owner')`, [user.id, space!.id]);
    return { space };
  });

  app.get('/spaces/:spaceId/members', async (req, reply) => {
    if (!(await requireSpace(req, reply, (req.params as any).spaceId))) return;
    const rows = await q(
      `SELECT u.id, u.name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.space_id = $1 ORDER BY m.created_at`,
      [(req.params as any).spaceId]
    );
    return { members: rows };
  });

  app.post('/spaces/:spaceId/invite', async (req, reply) => {
    if (!(await requireSpace(req, reply, (req.params as any).spaceId, 'owner'))) return;
    const body = z
      .object({ email: z.string().email(), role: z.enum(['editor', 'viewer']).default('editor') })
      .parse(req.body);
    const user = await one<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [body.email.toLowerCase()]);
    if (!user) return reply.code(404).send({ error: 'No account with that email yet — they must register first' });
    await q(
      `INSERT INTO memberships (user_id, space_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, space_id) DO UPDATE SET role = EXCLUDED.role`,
      [user.id, (req.params as any).spaceId, body.role]
    );
    void recordActivity(String((req.params as any).spaceId), req.user!.id, 'member_joined', { email: body.email, role: body.role });
    return { ok: true };
  });

  app.patch('/spaces/:spaceId/members/:userId', async (req, reply) => {
    if (!(await requireSpace(req, reply, (req.params as any).spaceId, 'owner'))) return;
    const body = z.object({ role: z.enum(['owner', 'editor', 'viewer']) }).parse(req.body);
    await q(`UPDATE memberships SET role = $1 WHERE user_id = $2 AND space_id = $3`, [
      body.role,
      (req.params as any).userId,
      (req.params as any).spaceId,
    ]);
    return { ok: true };
  });

  app.get('/spaces/:spaceId/settings', async (req, reply) => {
    if (!(await requireSpace(req, reply, (req.params as any).spaceId))) return;
    const row = await one<{ data: any }>(`SELECT data FROM settings WHERE space_id = $1`, [
      (req.params as any).spaceId,
    ]);
    return { settings: row?.data ?? {} };
  });

  app.patch('/spaces/:spaceId/settings', async (req, reply) => {
    if (!(await requireSpace(req, reply, (req.params as any).spaceId, 'owner'))) return;
    const body = z.object({ settings: z.record(z.any()) }).parse(req.body);
    await q(
      `INSERT INTO settings (space_id, data) VALUES ($1, $2)
       ON CONFLICT (space_id) DO UPDATE SET data = settings.data || EXCLUDED.data`,
      [(req.params as any).spaceId, JSON.stringify(body.settings)]
    );
    return { ok: true };
  });
}
