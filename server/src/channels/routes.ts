import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireSpace, requireService, rid } from '../lib/http.js';
import { runAgentLoop } from '../agents/engine.js';

/**
 * Channel link management (Slack via CopilotKit Channels SDK).
 *
 * The long-running channels process (../…/channels) resolves each incoming
 * Slack message to a SET space through the `channel_links` table, then runs
 * the SET agent loop over HTTP with a service JWT. Owners manage links here;
 * the channels process polls /api/channels/resolve (internal, service-token
 * guarded) and heartbeats to /api/channels/heartbeat.
 */

// In-process heartbeat of the channels listener (single server instance).
const heartbeat = { lastSeen: 0 as number, channelCode: '' as string, online: false as boolean };

export async function channelRoutes(app: FastifyInstance) {
  app.get('/spaces/:spaceId/channels', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'owner'))) return;
    const links = await q(
      `SELECT cl.id, cl.platform, cl.platform_id, cl.platform_name, cl.created_at,
              u.name AS linked_by_name
       FROM channel_links cl LEFT JOIN users u ON u.id = cl.linked_by
       WHERE cl.space_id = $1 ORDER BY cl.created_at DESC`,
      [spaceId]
    );
    return {
      links,
      service: {
        online: heartbeat.online && Date.now() - heartbeat.lastSeen < 120_000,
        lastSeen: heartbeat.lastSeen || null,
        channelCode: heartbeat.channelCode || null,
      },
    };
  });

  app.post('/spaces/:spaceId/channels', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'owner'))) return;
    const body = z
      .object({
        platform: z.enum(['slack', 'teams', 'discord', 'whatsapp', 'telegram']),
        platformId: z.string().min(2),
        platformName: z.string().optional(),
      })
      .parse(req.body);
    const link = await one<any>(
      `INSERT INTO channel_links (platform, platform_id, platform_name, space_id, linked_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (platform, platform_id) DO UPDATE SET space_id = EXCLUDED.space_id, linked_by = EXCLUDED.linked_by, platform_name = EXCLUDED.platform_name
       RETURNING *`,
      [body.platform, body.platformId, body.platformName ?? null, spaceId, req.user!.id]
    );
    return { link };
  });

  app.delete('/spaces/:spaceId/channels/:id', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'owner'))) return;
    const id = rid((req.params as any).id);
    await q(`DELETE FROM channel_links WHERE id = $1 AND space_id = $2`, [id, spaceId]);
    return { ok: true };
  });

  // ---- internal endpoints used by the channels listener process ----

  app.post('/channels/heartbeat', async (req, reply) => {
    const body = z.object({ channelCode: z.string().optional(), online: z.boolean().default(true) }).parse(req.body ?? {});
    heartbeat.lastSeen = Date.now();
    heartbeat.online = body.online;
    heartbeat.channelCode = body.channelCode ?? heartbeat.channelCode;
    return { ok: true };
  });

  // Resolve a platform workspace → SET space (+ service identity check).
  app.get('/channels/resolve', async (req, reply) => {
    if (!(await requireService(req, reply))) return;
    const platform = String((req.query as any).platform ?? 'slack');
    const platformId = String((req.query as any).platformId ?? '');
    if (!platformId) return reply.code(400).send({ error: 'platformId required' });
    const link = await one<any>(
      `SELECT space_id, linked_by FROM channel_links WHERE platform = $1 AND platform_id = $2`,
      [platform, platformId]
    );
    return { linked: !!link, spaceId: link?.space_id ?? null, actingUserId: link?.linked_by ?? null };
  });

  // Service-only agent run over the shared engine (used by the channels
  // listener). Executes as the owner who linked the workspace; approvals off —
  // Slack-triggered writes are audited in agent_runs like any other run.
  app.post('/channels/agent/run', async (req, reply) => {
    if (!(await requireService(req, reply))) return;
    const body = z
      .object({
        spaceId: z.string(),
        message: z.string().min(1),
        threadId: z.string().optional(),
        context: z.record(z.any()).optional(),
      })
      .parse(req.body);
    const link = await one<any>(`SELECT linked_by FROM channel_links WHERE space_id = $1 LIMIT 1`, [body.spaceId]);
    if (!link?.linked_by) return reply.code(404).send({ error: 'Space is not linked to a channel' });

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    await runAgentLoop({
      spaceId: body.spaceId,
      userId: link.linked_by,
      threadId: body.threadId,
      message: body.message,
      context: { ...(body.context as any), view: 'slack' },
      requireApprovals: false,
      source: 'slack',
      emit: (type, payload) => reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`),
    });
    reply.raw.end();
  });
}
