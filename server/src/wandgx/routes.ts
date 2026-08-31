import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { one, q } from '../db.js';
import { requireSpace } from '../lib/http.js';
import { requireSurface } from '../surfaces.js';
import { config } from '../config.js';
import { applyWandgxEvent, startWandgxBuild, wandgxConfigured, wandgxHealth } from './client.js';
/**
 * WandGx creation connector routes.
 * * /spaces/:id/wandgx/* — user-facing (JWT + editor role + surface gate)
 * /wandgx/events        — machine-facing webhook from the WandGx instance,
 *                         HMAC-SHA256 signed (x-wandgx-signature over
 *                         `${spaceId}.${timestamp}.${eventId}.${rawBody}`,
 *                         5-minute skew) or plain shared-secret bearer.
 * /wandgx/health        — machine-facing connection probe.
 */

const WEBHOOK_SKEW_MS = 5 * 60 * 1000;

function verifyWebhook(req: any, reply: FastifyReply): boolean {
  const secret = config.wandgx.webhookSecret;
  if (!secret) {
    reply.code(503).send({ error: 'WANDGX_WEBHOOK_SECRET is not configured' });
    return false;
  }
  if (req.headers.authorization === `Bearer ${secret}`) return true;
  const sig = String(req.headers['x-wandgx-signature'] ?? '');
  const ts = String(req.headers['x-wandgx-timestamp'] ?? '');
  const eventId = String(req.headers['x-wandgx-event-id'] ?? '');
  if (!sig || !ts || !eventId) {
    reply.code(401).send({ error: 'Missing webhook signature headers' });
    return false;
  }
  if (Math.abs(Date.now() - Number(ts)) > WEBHOOK_SKEW_MS) {
    reply.code(401).send({ error: 'Stale webhook timestamp' });
    return false;
  }
  const body = (req as any).rawBody ?? '';
  const spaceId = String(req.body?.spaceId ?? '');
  const expected = crypto.createHmac('sha256', secret).update(`${spaceId}.${ts}.${eventId}.${body}`).digest('hex');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    reply.code(401).send({ error: 'Invalid webhook signature' });
    return false;
  }
  return true;
}

export async function wandgxRoutes(app: FastifyInstance) {
  app.post('/spaces/:spaceId/wandgx/builds', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    if (!(await requireSurface(reply, spaceId, 'wandgx'))) return;
    const body = z
      .object({
        prompt: z.string().min(1),
        title: z.string().optional(),
        pageId: z.string().optional(),
      })
      .parse(req.body);
    try {
      const result = await startWandgxBuild({ spaceId, userId: req.user!.id, ...body });
      if (result.error) return reply.code(502).send({ build: result.build, error: result.error });
      return reply.code(201).send({ build: result.build, remote: result.remote });
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message ?? 'Build failed' });
    }
  });

  app.get('/spaces/:spaceId/wandgx/builds', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const builds = await q(
      `SELECT b.id, b.title, b.prompt, b.status, b.page_id, b.wandgx_project_id, b.wandgx_build_id,
              b.repo_url, b.live_url, b.error, b.created_at, b.updated_at, u.name AS created_by_name
       FROM wandgx_builds b LEFT JOIN users u ON u.id = b.created_by
       WHERE b.space_id = $1 ORDER BY b.created_at DESC LIMIT 100`,
      [spaceId]
    );
    return { builds };
  });

  // One-tap variants: rebuild a past build (or a page's spec) in another
  // language. The variant stacks on the same page's Build log, so approaches
  // sit side by side for comparison.
  app.post('/spaces/:spaceId/wandgx/variants', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    if (!(await requireSurface(reply, spaceId, 'wandgx'))) return;
    const body = z
      .object({
        buildId: z.string().optional(),
        pageRef: z.string().optional(),
        language: z.string().max(60).optional(),
      })
      .parse(req.body);
    const language = (body.language ?? '').replace(/[\r\n`]+/g, ' ').trim();
    if (!language) return reply.code(400).send({ error: 'language is required' });
    if (!body.buildId === !body.pageRef) {
      return reply.code(400).send({ error: 'Provide exactly one of buildId or pageRef' });
    }

    let basePrompt: string;
    let baseTitle: string;
    let pageId: string | null = null;
    if (body.buildId) {
      const build = await one<{ id: string; title: string; prompt: string; page_id: string | null }>(
        `SELECT id, title, prompt, page_id FROM wandgx_builds WHERE id::text = $1 AND space_id = $2`,
        [body.buildId, spaceId]
      );
      if (!build) return reply.code(404).send({ error: 'Build not found' });
      basePrompt = build.prompt;
      baseTitle = build.title;
      pageId = build.page_id;
    } else {
      const page = await one<{ id: string; title: string; markdown: string | null }>(
        `SELECT id, title, markdown FROM pages WHERE (id::text = $1 OR lower(title) = lower($1)) AND space_id = $2 AND deleted_at IS NULL`,
        [body.pageRef, spaceId]
      );
      if (!page) return reply.code(404).send({ error: 'Page not found' });
      basePrompt = (page.markdown ?? '').slice(0, 3000);
      baseTitle = page.title;
      pageId = page.id;
    }

    const prompt =
      `Recreate "${baseTitle}" as a ${language} project, preserving the feature set, behavior and rough scope.\n\n` +
      `Original spec:\n${basePrompt}\n\n` +
      `Call out the ${language}-idiomatic choices (libraries, memory model, tooling) in the README so a learner can compare approaches.`;

    try {
      const result = await startWandgxBuild({
        spaceId,
        userId: req.user!.id,
        prompt,
        title: `${baseTitle} — ${language} variant`,
        pageId,
      });
      if (result.error) return reply.code(502).send({ build: result.build, error: result.error });
      return reply.code(201).send({ build: result.build, remote: result.remote });
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message ?? 'Variant build failed' });
    }
  });

  app.get('/spaces/:spaceId/wandgx/status', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const health = await wandgxHealth();
    return { configured: wandgxConfigured(), url: config.wandgx.url, ...health };
  });

  // ---- machine-facing (WandGx instance) ----

  app.get('/wandgx/health', async (req, reply) => {
    const auth = String(req.headers.authorization ?? '');
    if (!wandgxConfigured() && !config.wandgx.webhookSecret) {
      return { ok: true, service: 'set', connector: 'unconfigured' };
    }
    if (auth !== `Bearer ${config.wandgx.token}` && auth !== `Bearer ${config.wandgx.webhookSecret}`) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    return { ok: true, service: 'set', version: '2.1.0' };
  });

  app.post('/wandgx/events', async (req, reply) => {
    if (!verifyWebhook(req, reply)) return;
    const body = z
      .object({
        spaceId: z.string().uuid(),
        type: z.string().min(1),
        buildRowId: z.string().optional(),
        buildId: z.string().optional(),
        status: z.enum(['queued', 'building', 'deployed', 'error']).optional(),
        repoUrl: z.string().optional(),
        liveUrl: z.string().optional(),
        error: z.string().optional(),
      })
      .parse(req.body);
    const result = await applyWandgxEvent(body);
    if (!result.applied) return reply.code(404).send({ error: 'No matching build for this space' });
    return { ok: true, build: result.build };
  });
}
