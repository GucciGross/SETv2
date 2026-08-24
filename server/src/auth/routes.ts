import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { one, q } from '../db.js';
import { signToken } from '../lib/tokens.js';
import { requireUser } from '../lib/http.js';
import crypto from 'node:crypto';
import { config } from '../config.js';

/** Naive in-memory IP rate limiter for auth endpoints (10 req/min). */
const hits = new Map<string, { n: number; reset: number }>();
function rateLimited(route: string, ip: string, max = 10, windowMs = 60_000): boolean {
  const key = `${route}:${ip}`;
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  h.n += 1;
  return h.n > max;
}

async function sendMail(to: string, subject: string, text: string) {
  if (!config.smtp.host) return false;
  const nodemailer = await import('nodemailer');
  const mail = nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined });
  await mail.sendMail({ from: config.smtp.from, to, subject, text });
  return true;
}

const creds = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120).optional(),
  password: z.string().min(8).max(200),
});

async function createPersonalSpace(userId: string, name: string) {
  const space = await one<{ id: string }>(
    `INSERT INTO spaces (name, kind, icon, owner_id) VALUES ($1, 'personal', '', $2) RETURNING id`,
    [`${name}'s Vault`, userId]
  );
  await q(`INSERT INTO memberships (user_id, space_id, role) VALUES ($1, $2, 'owner')`, [
    userId,
    space!.id,
  ]);
  // Starter home page
  await q(
    `INSERT INTO pages (space_id, title, icon, markdown) VALUES ($1, 'Welcome to SET', '', $2)`,
    [
      space!.id,
      `# Welcome to SET\n\nYour **Strategic Enablement Toolkit** — pages, databases, knowledge graph, grounded research, AI copilots and 3D learning.\n\n- Type [[wiki links]] to connect pages\n- Open **Graph** to see your knowledge graph\n- Create a **Notebook** and chat with your sources\n- Configure an LLM provider in Settings (Ollama or any OpenAI-compatible endpoint)`
    ]
  );
  return space!.id;
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (req, reply) => {
    if (!config.registrationOpen) return reply.code(403).send({ error: 'Registration is closed on this server' });
    if (rateLimited(req.routerPath ?? 'unknown', req.ip)) return reply.code(429).send({ error: 'Too many attempts — try again in a minute' });
    const parsed = creds.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid registration (password  8 chars)' });
    const { email, name, password } = parsed.data;
    const exists = await one(`SELECT id FROM users WHERE email = $1`, [email.toLowerCase()]);
    if (exists) return reply.code(409).send({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 10);
    const user = await one<{ id: string; email: string; name: string; mascot: any; onboarding: any }>(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name, mascot, onboarding`,
      [email.toLowerCase(), name ?? email.split('@')[0], hash]
    );
    await createPersonalSpace(user!.id, user!.name);
    return { token: signToken(user!), user };
  });

  app.post('/auth/login', async (req, reply) => {
    if (rateLimited(req.routerPath ?? 'unknown', req.ip)) return reply.code(429).send({ error: 'Too many attempts — try again in a minute' });
    const parsed = creds.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid credentials' });
    const { email, password } = parsed.data;
    const user = await one<{ id: string; email: string; name: string; password_hash: string; mascot: any; onboarding: any }>(
      `SELECT id, email, name, password_hash, mascot, onboarding FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return reply.code(401).send({ error: 'Invalid email or password' });
    return {
      token: signToken({ id: user.id, email: user.email, name: user.name }),
      user: { id: user.id, email: user.email, name: user.name, mascot: user.mascot ?? null, onboarding: user.onboarding ?? {} },
    };
  });

  app.post('/auth/forgot', async (req, reply) => {
    if (rateLimited(req.routerPath ?? 'unknown', req.ip, 5)) return reply.code(429).send({ error: 'Too many attempts' });
    const body = z.object({ email: z.string().email() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid email' });
    const user = await one<any>(`SELECT id, email, name FROM users WHERE email = $1`, [body.data.email.toLowerCase()]);
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      await q(
        `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
        [user.id, hash]
      );
      const link = `${config.appUrl}/reset?token=${token}`;
      const sent = await sendMail(user.email, 'SET password reset', `Reset your SET password:

${link}

This link expires in 1 hour.`);
      if (!sent) console.log(`[auth] password reset link for ${user.email}: ${link}`);
    }
    // always 200 — never reveal whether the account exists
    return { ok: true };
  });

  app.post('/auth/reset', async (req, reply) => {
    if (rateLimited(req.routerPath ?? 'unknown', req.ip, 5)) return reply.code(429).send({ error: 'Too many attempts' });
    const body = z.object({ token: z.string().min(32), password: z.string().min(8).max(200) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid token or password (min 8 chars)' });
    const hash = crypto.createHash('sha256').update(body.data.token).digest('hex');
    const reset = await one<any>(
      `SELECT id, user_id FROM password_resets WHERE token_hash = $1 AND NOT used AND expires_at > now()`,
      [hash]
    );
    if (!reset) return reply.code(400).send({ error: 'This reset link is invalid or has expired' });
    const newHash = await bcrypt.hash(body.data.password, 10);
    await q(`UPDATE users SET password_hash = $2 WHERE id = $1`, [reset.user_id, newHash]);
    await q(`UPDATE password_resets SET used = true WHERE id = $1`, [reset.id]);
    return { ok: true };
  });

  app.get('/auth/me', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const full = await one<{ mascot: any; onboarding: any }>(`SELECT mascot, onboarding FROM users WHERE id = $1`, [user.id]);
    return { user: { ...user, mascot: full?.mascot ?? null, onboarding: full?.onboarding ?? {} } };
  });

  app.put('/users/mascot', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const body = z
      .object({
        name: z.string().min(1).max(40),
        species: z.enum(['bot', 'cat', 'blob', 'mouse']),
        bodyColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        eyes: z.enum(['normal', 'happy', 'sleepy', 'visor']),
        accessory: z.enum(['none', 'antenna', 'halo', 'headphones', 'hardhat', 'party']),
        enabled: z.boolean().optional(),
      })
      .parse(req.body);
    await q(`UPDATE users SET mascot = $2 WHERE id = $1`, [user.id, JSON.stringify(body)]);
    return { mascot: body };
  });
}

export { createPersonalSpace };
