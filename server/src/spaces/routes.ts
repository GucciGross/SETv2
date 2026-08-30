import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireSpace, requireUser } from '../lib/http.js';
import { recordActivity } from '../team/activity.js';
import { config } from '../config.js';
import { sendMail, htmlEmail } from '../lib/mail.js';
import { signInviteToken, verifyInviteToken } from '../lib/tokens.js';

export async function spaceRoutes(app: FastifyInstance) {
  /** Shared invite path: existing users join instantly, others get an emailed (or logged) invite link. */
  const inviteOne = async (spaceId: string, inviter: { id: string; name: string }, email: string, role: 'editor' | 'viewer') => {
    const user = await one<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
    if (user) {
      const already = await one<{ role: string }>(
        `SELECT role FROM memberships WHERE user_id = $1 AND space_id = $2`,
        [user.id, spaceId]
      );
      if (already) return { email, result: 'already' as const, role: already.role };
      await q(
        `INSERT INTO memberships (user_id, space_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, space_id) DO UPDATE SET role = EXCLUDED.role`,
        [user.id, spaceId, role]
      );
      void recordActivity(spaceId, inviter.id, 'member_joined', { email, role, via: 'roster' });
      return { email, result: 'added' as const, role };
    }
    const space = await one<{ name: string }>(`SELECT name FROM spaces WHERE id = $1`, [spaceId]);
    const spaceName = space?.name ?? 'a workspace';
    const link = `${config.appUrl}/join?token=${signInviteToken({ spaceId, email, role })}`;
    const text = `${inviter.name} invited you to collaborate in "${spaceName}" on SET — the Strategic Enablement Toolkit.\n\nAccept the invite:\n\n${link}\n\nThe link expires in 7 days. If you don't have an account yet, you can create one with this email address (${email}) when you open it.`;
    const { sent } = await sendMail({
      to: email,
      subject: `${inviter.name} invited you to "${spaceName}" on SET`,
      text,
      html: htmlEmail(
        `${inviter.name} invited you to "${spaceName}"`,
        `<p><b>${inviter.name}</b> invited you to collaborate in <b>${spaceName}</b> on SET — the Strategic Enablement Toolkit.</p><p>The invite expires in 7 days. No account yet? You can create one with this email address after opening the link.</p>`,
        { label: 'Accept invite', url: link }
      ),
    });
    if (!sent) console.log(`[spaces] invite link for ${email} (email not configured): ${link}`);
    return { email, result: 'invited' as const, emailed: sent, ...(sent ? {} : { link }) };
  };

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

    const rows = body.csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const seen = new Set<string>();
    const results: any[] = [];
    for (const line of rows.slice(0, 200)) {
      const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
      const emailCell = cells.find((c) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c));
      if (!emailCell) continue; // header rows and junk lines pass through silently
      const email = emailCell.toLowerCase();
      if (seen.has(email)) continue;
      seen.add(email);
      const roleCell = (cells.find((c) => c !== emailCell) ?? '').toLowerCase();
      const role = roleCell === 'viewer' || roleCell === 'owner' ? 'viewer' : roleCell === 'editor' ? 'editor' : body.defaultRole;
      results.push(await inviteOne(String(spaceId), req.user!, email, role as 'editor' | 'viewer'));
    }
    const summary = results.reduce(
      (acc: any, r) => ({ ...acc, [r.result]: (acc[r.result] ?? 0) + 1 }),
      { added: 0, invited: 0, already: 0 }
    );
    void recordActivity(String(spaceId), req.user!.id, 'roster_imported', { ...summary, total: results.length });
    return { results, summary };
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
