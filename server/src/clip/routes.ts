import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireUser } from '../lib/http.js';
import { getProvider } from '../llm/router.js';
import { ingestSource } from '../rag/search.js';
import { recordActivity } from '../team/activity.js';

/**
 * Web clipper: a bookmarklet on an arbitrary origin POSTs the current page
 * (title, url, selection or body text) into a SET notebook, using a personal
 * long-lived clip token. CORS for /clip is opened up in index.ts (same-origin
 * policy would otherwise block the bookmarklet's fetch).
 */

const CLIP_PREFIX = 'setclip_';

/** Naive per-token rate limiter (30 clips/min). */
const hits = new Map<string, { n: number; reset: number }>();
function rateLimited(key: string, max = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  h.n += 1;
  return h.n > max;
}

async function userForClipToken(header: string | undefined): Promise<string | null> {
  if (!header?.startsWith(`Bearer ${CLIP_PREFIX}`)) return null;
  const token = header.slice('Bearer '.length); // keep the setclip_ prefix — creation hashes the full token
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const row = await one<{ user_id: string }>(`SELECT user_id FROM clip_tokens WHERE token_hash = $1`, [hash]);
  return row?.user_id ?? null;
}

export async function clipRoutes(app: FastifyInstance) {
  app.post('/clip', async (req, reply) => {
    const userId = await userForClipToken(req.headers.authorization);
    if (!userId) return reply.code(401).send({ error: 'Invalid or missing clip token' });
    if (rateLimited(userId)) return reply.code(429).send({ error: 'Too many clips — try again in a minute' });

    const body = z
      .object({
        url: z.string().max(2048).optional(),
        title: z.string().max(500).optional(),
        text: z.string().min(1).max(500_000),
        spaceId: z.string().uuid().optional(),
        notebookId: z.string().uuid().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'A non-empty `text` is required' });
    const { url, title, text, spaceId, notebookId } = body.data;

    // resolve target: explicit space/notebook (validated by membership), else first space's "Clips"
    let targetSpace = spaceId ?? null;
    if (targetSpace) {
      const member = await one<{ id: string }>(
        `SELECT space_id AS id FROM memberships WHERE user_id = $1 AND space_id = $2`,
        [userId, targetSpace]
      );
      if (!member) return reply.code(403).send({ error: 'You are not a member of that space' });
    } else {
      const first = await one<{ id: string }>(
        `SELECT space_id AS id FROM memberships WHERE user_id = $1 ORDER BY created_at LIMIT 1`,
        [userId]
      );
      if (!first) return reply.code(400).send({ error: 'No space to clip into' });
      targetSpace = first.id;
    }

    let notebook = null as { id: string } | null;
    if (notebookId) {
      notebook = await one<{ id: string }>(
        `SELECT id FROM notebooks WHERE id = $1 AND space_id = $2`,
        [notebookId, targetSpace]
      );
      if (!notebook) return reply.code(403).send({ error: 'Notebook not found in that space' });
    } else {
      notebook = await one<{ id: string }>(
        `SELECT id FROM notebooks WHERE space_id = $1 AND title = 'Clips' LIMIT 1`,
        [targetSpace]
      );
      if (!notebook) {
        notebook = await one<{ id: string }>(
          `INSERT INTO notebooks (space_id, title, description) VALUES ($1, 'Clips', 'Web clips from the bookmarklet') RETURNING id`,
          [targetSpace]
        );
      }
    }

    const name = (title ?? url ?? 'Untitled clip').slice(0, 300);
    const src = await one<{ id: string }>(
      `INSERT INTO sources (notebook_id, kind, name, uri, mime, size_bytes, text_content, meta, status)
       VALUES ($1, 'web', $2, $3, 'text/html', $4, $5, $6, 'pending') RETURNING id`,
      [notebook!.id, name, url ?? null, text.length, text, JSON.stringify({ clip: true })]
    );
    await q(`UPDATE clip_tokens SET last_used_at = now()
             WHERE token_hash = $1`, [
      crypto.createHash('sha256').update(req.headers.authorization!.slice('Bearer '.length)).digest('hex'),
    ]);

    // index asynchronously exactly like the notebook upload path
    const provider = await getProvider(targetSpace);
    void ingestSource(src!.id, provider).catch(() => {
      void q(`UPDATE sources SET status = 'error' WHERE id = $1`, [src!.id]);
    });
    void recordActivity(targetSpace, userId, 'web_clipped', { url: url ?? '', title: name, notebookId: notebook!.id });

    return { ok: true, notebookId: notebook!.id, sourceId: src!.id };
  });

  // ---- token management (normal JWT auth) ----

  app.post('/users/clip-tokens', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const body = z.object({ name: z.string().max(120).optional() }).parse(req.body ?? {});
    const token = CLIP_PREFIX + crypto.randomBytes(24).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const row = await one<any>(
      `INSERT INTO clip_tokens (user_id, name, token_hash) VALUES ($1, $2, $3)
       RETURNING id, name, created_at`,
      [user.id, body.name ?? 'bookmarklet', hash]
    );
    // plaintext is returned exactly once — only the hash is stored
    return { token: { ...row, plaintext: token } };
  });

  app.get('/users/clip-tokens', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const rows = await q(
      `SELECT id, name, created_at, last_used_at FROM clip_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
      [user.id]
    );
    return { tokens: rows };
  });

  app.delete('/users/clip-tokens/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    await q(`DELETE FROM clip_tokens WHERE id = $1 AND user_id = $2`, [
      (req.params as any).id,
      user.id,
    ]);
    return { ok: true };
  });
}
