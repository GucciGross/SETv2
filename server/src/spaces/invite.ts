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
 * Private preview: only site admins may invite at all (checked here so every
 * caller — HTTP invite, bulk roster, MCP import_roster — is covered), and
 * unknown emails are provisioned directly (account + personal space +
 * membership in one transaction) with a one-time expiring set-password email
 * reusing the existing password_resets flow. The random initial password
 * exists only as a bcrypt hash — never returned, logged, or emailed.
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

async function requireSiteAdmin(inviterId: string) {
  if (!previewEnabled()) return;
  const row = await one<{ is_site_admin: boolean }>(`SELECT is_site_admin FROM users WHERE id = $1`, [inviterId]);
  if (!row?.is_site_admin) throw new SiteAdminRequiredError();
}

export async function inviteOne(spaceId: string, inviter: Inviter, email: string, role: 'editor' | 'viewer'): Promise<InviteOutcome> {
  await requireSiteAdmin(inviter.id);
  const user = await one<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  if (user) {
    const already = await one<{ role: string }>(`SELECT role FROM memberships WHERE user_id = $1 AND space_id = $2`, [user.id, spaceId]);
    if (already) return { email, result: 'already', role: already.role };
    await q(
      `INSERT INTO memberships (user_id, space_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, space_id) DO UPDATE SET role = EXCLUDED.role`,
      [user.id, spaceId, role]
    );
    void recordActivity(spaceId, inviter.id, 'member_joined', { email, role });
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
      `<p><b>${inviter.name}</b> invited you to collaborate in <b>${spaceName}</b> on SET — the Strategic Enablement Toolkit.</p><p>The invite expires in 7 days. No account yet? You can create one with this email address after opening the link.</p>`,
      { label: 'Accept invite', url: link }
    ),
  });
  if (!sent) console.log(`[spaces] invite link for ${email} (email not configured): ${link}`);
  return { email, result: 'invited', emailed: sent, ...(sent ? {} : { link }) };
}

/** Provision an account + personal space + membership atomically, then email a one-time set-password link. */
async function provisionNewMember(
  spaceId: string,
  inviter: Inviter,
  email: string,
  role: 'editor' | 'viewer',
  spaceName: string
): Promise<InviteOutcome> {
  const name = email.split('@')[0];
  // The initial password exists only as a bcrypt hash; nobody ever sees it.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
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
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  void recordActivity(spaceId, inviter.id, 'member_joined', { email, role, via: 'site_admin_provision' });
  const emailed = await sendSetupEmail(email, inviter.name, spaceName, userId);
  return { email, result: 'provisioned', emailed };
}

/** One-time expiring set-password link via the existing password_resets flow. Raw tokens go only into the email. */
async function sendSetupEmail(email: string, inviterName: string, spaceName: string, userId: string): Promise<boolean> {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await q(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '24 hours')`, [userId, hash]);
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
