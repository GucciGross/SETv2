import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireSpace, requireUser } from '../lib/http.js';
import { recordActivity } from '../team/activity.js';
import { config } from '../config.js';
import { verifyInviteToken } from '../lib/tokens.js';
import { inviteOne, inviteBulk } from './invite.js';

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
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'owner'))) return;
    const body = z
      .object({ email: z.string().email(), role: z.enum(['editor', 'viewer']).default('editor') })
      .parse(req.body);
    const out = await inviteOne(String(spaceId), req.user!, body.email.toLowerCase(), body.role);
    return {
      ok: true,
      added: out.result === 'added',
      invited: out.result === 'invited',
      emailed: out.result === 'invited' ? out.emailed : undefined,
      ...(out.result === 'invited' && !out.emailed ? { link: out.link } : {}),
    };
  });

  /** Roster import: CSV text with an email column (+ optional role column). Header row tolerated. */
  app.post('/spaces/:spaceId/invite-bulk', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'owner'))) return;
    const body = z
      .object({ csv: z.string().min(1).max(200_000), defaultRole: z.enum(['editor', 'viewer']).default('editor') })
      .parse(req.body);
    return inviteBulk(String(spaceId), req.user!, body.csv, body.defaultRole);
  });

  /** Redeem an emailed invite: requires being signed in as the invited email. */
  app.post('/spaces/join', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const body = z.object({ token: z.string().min(10) }).parse(req.body);
    const invite = verifyInviteToken(body.token);
    if (!invite) return reply.code(400).send({ error: 'This invite link is invalid or has expired (invites last 7 days)' });
    if (user.email.toLowerCase() !== invite.email)
      return reply.code(403).send({ error: `This invite was sent to ${invite.email} — sign in with that email address to accept it` });
    const space = await one<{ id: string; name: string }>(`SELECT id, name FROM spaces WHERE id = $1`, [invite.spaceId]);
    if (!space) return reply.code(404).send({ error: 'The workspace for this invite no longer exists' });
    await q(
      `INSERT INTO memberships (user_id, space_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, space_id) DO NOTHING`,
      [user.id, invite.spaceId, invite.role]
    );
    void recordActivity(invite.spaceId, user.id, 'member_joined', { email: user.email, role: invite.role, via: 'invite_link' });
    return { ok: true, spaceId: space.id, spaceName: space.name, role: invite.role };
  });

  app.patch('/spaces/:spaceId/members/:userId', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'owner'))) return;
    const body = z.object({ role: z.enum(['owner', 'editor', 'viewer']) }).parse(req.body);
    const target = await one<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [
      (req.params as any).userId,
    ]);
    await q(`UPDATE memberships SET role = $1 WHERE user_id = $2 AND space_id = $3`, [
      body.role,
      (req.params as any).userId,
      spaceId,
    ]);
    void recordActivity(String(spaceId), req.user!.id, 'member_role_changed', {
      email: target?.email ?? (req.params as any).userId,
      role: body.role,
    });
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
