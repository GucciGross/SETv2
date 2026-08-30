import { one, q } from '../db.js';
import { config } from '../config.js';
import { sendMail, htmlEmail } from '../lib/mail.js';
import { signInviteToken } from '../lib/tokens.js';
import { recordActivity } from '../team/activity.js';

/**
 * Shared invite path (HTTP routes + MCP tool): existing users join a space
 * instantly; anyone else gets a signed, 7-day invite link by email (or in
 * the server log when mail isn't configured).
 */

export interface Inviter {
  id: string;
  name: string;
}

export type InviteOutcome =
  | { email: string; result: 'already'; role: string }
  | { email: string; result: 'added'; role: string }
  | { email: string; result: 'invited'; emailed: boolean; link?: string };

export async function inviteOne(spaceId: string, inviter: Inviter, email: string, role: 'editor' | 'viewer'): Promise<InviteOutcome> {
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

/** Roster import: CSV text with an email column (+ optional role column). Header row tolerated. */
export async function inviteBulk(
  spaceId: string,
  inviter: Inviter,
  csv: string,
  defaultRole: 'editor' | 'viewer' = 'editor'
): Promise<{ summary: { added: number; invited: number; already: number }; results: InviteOutcome[] }> {
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
