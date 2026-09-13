import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { one, q, pool } from '../db.js';
import { signToken } from '../lib/tokens.js';
import { requireUser } from '../lib/http.js';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { sendMail, htmlEmail } from '../lib/mail.js';
import { authRateLimited } from './rate-limit.js';
import { presentedSession, revokeSession } from './session.js';
import { deploymentSettings } from '../deployment.js';
import { previewEnabled, CLOUD_NOT_READY } from './preview.js';

const creds = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120).optional(),
  password: z.string().min(8).max(200),
});

async function createPersonalSpace(userId: string, name: string, database: Pick<PoolClient, 'query'> = pool) {
  const space = (await database.query(
    `INSERT INTO spaces (name, kind, icon, owner_id) VALUES ($1, 'personal', '', $2) RETURNING id`,
    [`${name}'s Vault`, userId])).rows[0];
  await database.query(`INSERT INTO memberships (user_id, space_id, role) VALUES ($1, $2, 'owner')`, [userId, space.id]);
  await database.query(
    `INSERT INTO pages (space_id, title, icon, markdown) VALUES ($1, 'Welcome to SET', '', $2)`,
    [space.id, `# Welcome to SET\n\nYour **Strategic Enablement Toolkit** — pages, databases, knowledge graph, grounded research, AI copilots and 3D learning.\n\n- Type [[wiki links]] to connect pages\n- Open **Graph** to see your knowledge graph\n- Create a **Notebook** and chat with your sources\n- Configure an LLM provider in Settings (Ollama or any OpenAI-compatible endpoint)`]);
  return space.id as string;
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (req, reply) => {
    if (previewEnabled()) return reply.code(403).send({ error: CLOUD_NOT_READY });
    if (!config.registrationOpen) return reply.code(403).send({ error: 'Registration is closed on this server' });
    if (await authRateLimited(req.routeOptions.url ?? 'unknown', req.ip)) return reply.code(429).send({ error: 'Too many attempts — try again in a minute' });
    // Credentials only — an isSiteAdmin key on the body is ignored; the flag
    // is never client-settable and there is no first-user auto-promotion.
    const parsed = creds.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid registration (password minimum 8 characters)' });
    const { email, name, password } = parsed.data;
    const hash = await bcrypt.hash(password, 10);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const user = (await client.query(
        `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING
         RETURNING id, email, name, mascot, onboarding, session_version`,
        [email.toLowerCase(), name ?? email.split('@')[0], hash])).rows[0];
      if (!user) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Email already registered' }); }
      await createPersonalSpace(user.id, user.name, client);
      await client.query('COMMIT');
      return { token: signToken({ ...user, sessionVersion: user.session_version }), user };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });

  app.post('/auth/login', async (req, reply) => {
    if (await authRateLimited(req.routeOptions.url ?? 'unknown', req.ip)) return reply.code(429).send({ error: 'Too many attempts — try again in a minute' });
    const parsed = creds.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid credentials' });
    const { email, password } = parsed.data;
    const user = await one<{ id: string; email: string; name: string; password_hash: string; mascot: any; onboarding: any; session_version: number; is_site_admin: boolean }>(
      `SELECT id, email, name, password_hash, mascot, onboarding, session_version, is_site_admin FROM users WHERE email = $1`, [email.toLowerCase()]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return reply.code(401).send({ error: previewEnabled() ? CLOUD_NOT_READY : 'Invalid email or password' });
    }
    return {
      token: signToken({ id: user.id, email: user.email, name: user.name, sessionVersion: user.session_version }),
      user: { id: user.id, email: user.email, name: user.name, mascot: user.mascot ?? null, onboarding: user.onboarding ?? {}, isSiteAdmin: !!user.is_site_admin },
    };
  });

  app.post('/auth/logout', async (req, reply) => {
    const identity = presentedSession(req);
    if (!identity) return reply.code(401).send({ error: 'A personal session is required' });
    await revokeSession(identity);
    const secure = config.appUrl.startsWith('https://') || req.protocol === 'https';
    reply.header('Set-Cookie', `set_asset_session=; Path=/api/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
    reply.header('Cache-Control', 'no-store');
    return { ok: true };
  });

  app.post('/auth/forgot', async (req, reply) => {
    if (await authRateLimited(req.routeOptions.url ?? 'unknown', req.ip, 5)) return reply.code(429).send({ error: 'Too many attempts' });
    const body = z.object({ email: z.string().email() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid email' });
    const user = await one<any>(`SELECT id, email, name FROM users WHERE email = $1`, [body.data.email.toLowerCase()]);
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      await q(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, [user.id, hash]);
      const link = `${config.appUrl.replace(/\/+$/, '')}/reset?token=${token}`;
      const { sent } = await sendMail({
        to: user.email, subject: 'SET password reset',
        text: `Reset your SET password:\n\n${link}\n\nThis link expires in 1 hour.`,
        html: htmlEmail('Reset your password', 'Someone (hopefully you) asked to reset the password for this SET account. The link below expires in 1 hour.', { label: 'Choose a new password', url: link }),
      });
      if (!sent) {
        if (deploymentSettings().exposure === 'private' && process.env.SET_LOG_AUTH_LINKS === '1') console.log(`[auth] private development reset link: ${link}`);
        else req.log.warn('Password-reset delivery failed; check the configured mail transport. No token was logged.');
      }
    }
    return { ok: true }; // Do not disclose account existence or delivery status.
  });

  app.post('/auth/reset', async (req, reply) => {
    if (await authRateLimited(req.routeOptions.url ?? 'unknown', req.ip, 5)) return reply.code(429).send({ error: 'Too many attempts' });
    const body = z.object({ token: z.string().min(32).max(256), password: z.string().min(8).max(200) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid token or password (min 8 characters)' });
    const hash = crypto.createHash('sha256').update(body.data.token).digest('hex');
    const newHash = await bcrypt.hash(body.data.password, 10);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const reset = (await client.query(
        `SELECT user_id FROM password_resets WHERE token_hash = $1 AND NOT used AND expires_at > now()`, [hash])).rows[0];
      if (!reset) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'This reset link is invalid or has expired' }); }
      // Lock the account first: multiple different reset links cannot deadlock each other.
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [reset.user_id]);
      const consumed = await client.query(
        `UPDATE password_resets SET used = true WHERE token_hash = $1 AND NOT used AND expires_at > now() RETURNING id`, [hash]);
      if (!consumed.rows.length) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'This reset link is invalid or has expired' }); }
      // The migration's trigger increments session_version atomically with the password.
      await client.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [reset.user_id, newHash]);
      await client.query(`UPDATE password_resets SET used = true WHERE user_id = $1`, [reset.user_id]);
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });

  app.get('/auth/me', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const full = await one<{ mascot: any; onboarding: any; is_site_admin: boolean }>(`SELECT mascot, onboarding, is_site_admin FROM users WHERE id = $1`, [user.id]);
    return { user: { ...user, mascot: full?.mascot ?? null, onboarding: full?.onboarding ?? {}, isSiteAdmin: !!full?.is_site_admin } };
  });

  /** Delete the account and solely owned spaces; retain shared content. */
  app.delete('/users/me', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const owned = (await client.query(
        `SELECT m.space_id FROM memberships m WHERE m.user_id = $1 AND m.role = 'owner'
         AND NOT EXISTS (SELECT 1 FROM memberships o WHERE o.space_id = m.space_id AND o.user_id <> $1 AND o.role = 'owner')`, [user.id])).rows;
      for (const o of owned) await client.query('DELETE FROM spaces WHERE id = $1', [o.space_id]);
      await client.query('UPDATE pages SET created_by = NULL WHERE created_by = $1', [user.id]);
      await client.query('UPDATE page_versions SET edited_by = NULL WHERE edited_by = $1', [user.id]);
      await client.query('UPDATE quiz_attempts SET graded_by = NULL WHERE graded_by = $1', [user.id]);
      await client.query('DELETE FROM users WHERE id = $1', [user.id]);
      await client.query('COMMIT');
      return { ok: true, spacesDeleted: owned.length };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });

  app.put('/users/mascot', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const body = z.object({
      name: z.string().min(1).max(40),
      species: z.enum(['bot', 'cat', 'blob', 'mouse', 'dog', 'fox', 'bird', 'dragon', 'ghost', 'bloub']),
      bodyColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), eyes: z.enum(['normal', 'happy', 'sleepy', 'visor']),
      accessory: z.enum(['none', 'antenna', 'halo', 'headphones', 'hardhat', 'party', 'scarf', 'bow']), enabled: z.boolean().optional(),
    }).parse(req.body);
    await q(`UPDATE users SET mascot = $2 WHERE id = $1`, [user.id, JSON.stringify(body)]);
    return { mascot: body };
  });
  app.get('/users/preferences', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { getPreferences } = await import('../study/briefScheduler.js');
    return { preferences: await getPreferences(user.id) };
  });
  app.put('/users/preferences', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const body = z.object({ briefEnabled: z.boolean().optional(), briefHour: z.number().int().min(0).max(23).nullable().optional(), briefTz: z.string().max(64).optional(), theme: z.enum(['dark', 'light']).optional() }).parse(req.body);
    const { setPreferences } = await import('../study/briefScheduler.js');
    return { preferences: await setPreferences(user.id, body) };
  });
}
export { createPersonalSpace };
