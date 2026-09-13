import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { one, q, pool } from '../db.js';
import { config } from '../config.js';
import { sendMail, htmlEmail } from '../lib/mail.js';
import { signInviteToken } from '../lib/tokens.js';
import { recordActivity } from '../team/activity.js';
import { previewEnabled } from '../auth/preview.js';
import { createPersonalSpace } from '../auth/routes.js';

/**
 * Shared invite path (HTTP routes + MCP tool): existing users join a space
 * instantly; anyone else gets a signed, 7-day invite link by email (or in
 * the server log when mail isn't configured).
 *
 * Private preview: only site admins who are DB-verified owners of the target
 * workspace may invite at all. The check lives here so every caller — HTTP
 * invite, bulk roster, MCP import_roster — is covered (MCP's ctx.role is
 * caller-claimed, so authority is re-read from memberships). Unknown emails
 * are provisioned directly (account + personal space + membership + one-time
 * set-password token in ONE transaction) reusing the existing password_resets
 * flow. The random initial password exists only as a bcrypt hash — never
 * returned, logged, or emailed; the setup token goes only into the email.
 */

export interface Inviter {
  id: string;
  name: string;
}
export type InviteOutcome =
  | { email: string; result: 'already'; role: string }
  | { email: string; result: 'added'; role: string }
  | { email: string; result: 'invited'; emailed: boolean; link?: string }
  | { email: string; result: 'provisioned'; emailed: boolean };

export class SiteAdminRequiredError extends Error {
  constructor() {
    super('Only site admins can invite teammates during private preview');
  }
}

/** DB-verified authority: site admin AND owner membership of the target space. */
async function requireInviteAuthority(inviterId: string, spaceId: string) {
  if (!previewEnabled()) return;
  const admin = await one<{ is_site_admin: boolean }>(`SELECT is_site_admin FROM users WHERE id = $1`, [inviterId]);
  if (!admin?.is_site_admin) throw new SiteAdminRequiredError();
  const membership = await one<{ role: string }>(`SELECT role FROM memberships WHERE user_id = $1 AND space_id = $2`, [inviterId, spaceId]);
  if (membership?.role !== 'owner') throw new SiteAdminRequiredError();
}

export async function inviteOne(spaceId: string, inviter: Inviter, email: string, role: 'editor' | 'viewer'): Promise<InviteOutcome> {
  await requireInviteAuthority(inviter.id, spaceId);
  const user = await one<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  if (user) {
    const already = await one<{ role: string }>(`SELECT role FROM memberships WHERE user_id = $1 AND space_id = $2`, [user.id, spaceId]);
    if (already) return { email, result: 'already', role: already.role };
    await q(`INSERT INTO memberships (user_id, space_id, role) VALUES ($1, $2, $3)`, [user.id, spaceId, role]);
    void recordActivity(spaceId, inviter.id, 'member_joined', { email, role, via: 'site_admin_add' });
    return { email, result: 'added', role };
  }
  const space = await one<{ name: string }>(`SELECT name FROM spaces WHERE id = $1`, [spaceId]);
  const spaceName = space?.name ?? 'a workspace';
  if (previewEnabled()) return provisionNewMember(spaceId, inviter, email, role, spaceName);
  const link = `${config.appUrl}/join?token=${signInviteToken({ spaceId, email, role })}`;
  const text = `${inviter.name} invited you to collaborate in "${spaceName}" on SET — the Strategic Enablement Toolkit.\n\nAccept the invite:\n\n${link}\n\nThe link expires in 7 days. If you don't have an account yet, you can create one with this email address (${email}) when you open it.`;
  const { sent } = await sendMail({
    to: email,
    subject: `${inviter.name} invited you to "${spaceName}" on SET`,
    text,
    html: htmlEmail(
      `${inviter.name} invited you to "${spaceName}"`,
      `<p><b>${inviter.name}</b> invited you to collaborate in <b>${spaceName}</b> on SET — the Strategic Enablement Toolkit.</p><p>Existing users are added instantly; new users can sign up with this email (${email}) when they open the link. It expires in 7 days.</p>`,
      { label: 'Accept the invite', url: link }
    ),
  });
  if (!sent) console.log(`[spaces] invite link for ${email} (email not configured): ${link}`);
  return { email, result: 'invited', emailed: sent, ...(sent ? {} : { link }) };
}

/** Provision account + personal space + membership + set-password token atomically, then email the one-time link. */
async function provisionNewMember(
  spaceId: string,
  inviter: Inviter,
  email: string,
  role: 'editor' | 'viewer',
  spaceName: string
): Promise<InviteOutcome> {
  const name = email.split('@')[0];
  // The initial password exists only as a bcrypt hash; nobody ever sees it.
  // The setup token is generated up front so it can go into the email after
  // commit; only its hash is stored, inside the same transaction, so a failure
  // anywhere leaves no half-provisioned account or orphan token behind.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  const setupToken = crypto.randomBytes(32).toString('hex');
  const client = await pool.connect();
  let userId: string;
  try {
    await client.query('BEGIN');
    const user = (await client.query(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      [email, name, passwordHash])).rows[0];
    if (!user) throw new Error('Invite provisioning failed');
    userId = user.id;
    await createPersonalSpace(userId, name, client);
    await client.query(`INSERT INTO memberships (user_id, space_id, role) VALUES ($1, $2, $3)`, [userId, spaceId, role]);
    await client.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '24 hours')`,
      [userId, crypto.createHash('sha256').update(setupToken).digest('hex')]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  void recordActivity(spaceId, inviter.id, 'member_joined', { email, role, via: 'site_admin_provision' });
  const emailed = await sendSetupEmail(email, inviter.name, spaceName, setupToken);
  return { email, result: 'provisioned', emailed };
}

/** One-time expiring set-password link via the existing password_resets flow. Raw tokens go only into the email. */
async function sendSetupEmail(email: string, inviterName: string, spaceName: string, token: string): Promise<boolean> {
  const link = `${config.appUrl.replace(/\/+$/, '')}/reset?token=${token}`;
  const { sent } = await sendMail({
    to: email,
    subject: `${inviterName} invited you to "${spaceName}" on SET`,
    text: `${inviterName} invited you to collaborate in "${spaceName}" on SET — the Strategic Enablement Toolkit.\n\nYour account is ready. Choose your password:\n\n${link}\n\nThis link is one-time and expires in 24 hours. If it expires, use "Forgot password" on the sign-in page to get a new one.`,
    html: htmlEmail(
      `${inviterName} invited you to "${spaceName}"`,
      `<p><b>${inviterName}</b> invited you to collaborate in <b>${spaceName}</b> on SET — the Strategic Enablement Toolkit.</p><p>Your account is ready — choose your password below. The link is one-time and expires in 24 hours.</p>`,
      { label: 'Choose your password', url: link }
    ),
  });
  if (!sent) {
    // Never log the token or link — it grants account access. The teammate can
    // still use "Forgot password" on the sign-in page once mail works.
    console.log(`[spaces] setup email for ${email} could not be delivered (mail not configured); they can use "Forgot password" on the sign-in page`);
  }
  return sent;
}

/** Roster import: CSV text with an email column (+ optional role column). Header row tolerated. */
export async function inviteBulk(
  spaceId: string,
  inviter: Inviter,
  csv: string,
  defaultRole: 'editor' | 'viewer' = 'editor'
): Promise<{ summary: { added: number; invited: number; already: number; provisioned?: number }; results: InviteOutcome[] }> {
  const rows = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const seen = new Set<string>();
  const results: InviteOutcome[] = [];
  for (const line of rows.slice(0, 200)) {
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    const emailCell = cells.find((c) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c));
    if (!emailCell) continue; // header rows and junk lines pass through silently
    const email = emailCell.toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    const roleCell = (cells.find((c) => c !== emailCell) ?? '').toLowerCase();
    const role = roleCell === 'viewer' || roleCell === 'owner' ? 'viewer' : roleCell === 'editor' ? 'editor' : defaultRole;
    results.push(await inviteOne(spaceId, inviter, email, role as 'editor' | 'viewer'));
  }
  const summary = results.reduce(
    (acc: any, r) => ({ ...acc, [r.result]: (acc[r.result] ?? 0) + 1 }),
    { added: 0, invited: 0, already: 0 }
  );
  void recordActivity(spaceId, inviter.id, 'roster_imported', { ...summary, total: results.length });
  return { summary, results };
}
