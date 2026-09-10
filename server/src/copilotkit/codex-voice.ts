import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireSpace } from '../lib/http.js';
import { codexSessions } from '../codex/service.js';
import { CodexError, requireCodexVoice } from '../codex/policy.js';
import { voiceOffer } from '../codex/voice.js';

/** Deliberately narrow signaling/control routes, never an arbitrary RPC proxy. */
export async function codexVoiceRoutes(app: FastifyInstance) {
  async function authorize(req: FastifyRequest, reply: FastifyReply, spaceId: unknown) {
    requireCodexVoice(); // Cloud and unknown modes fail before any CLI work.
    reply.header('Cache-Control', 'no-store');
    if (!req.headers.authorization?.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Authorization header required.' }); return false;
    }
    return !!(await requireSpace(req, reply, spaceId));
  }
  function failure(reply: FastifyReply, error: unknown) {
    if (reply.sent || reply.raw.destroyed) return;
    return reply.code(error instanceof CodexError ? error.statusCode : 502).send({
      error: error instanceof CodexError ? error.message : 'Codex voice could not continue. No API fallback was used. Use text or reconnect.',
    });
  }
  app.post('/copilot/voice/codex/sessions', { bodyLimit: 100_000 }, async (req, reply) => {
    let session: Awaited<ReturnType<typeof codexSessions.openVoice>> | undefined;
    const lost = () => { if (!reply.raw.writableEnded) void session?.close(); };
    reply.raw.once('close', lost);
    try {
      const body = req.body as { spaceId?: unknown; sdp?: unknown } | null;
      if (!(await authorize(req, reply, body?.spaceId))) return;
      const sdp = voiceOffer(body?.sdp);
      session = await codexSessions.openVoice(req.user!.id, body!.spaceId as string);
      if (reply.raw.destroyed) { await session.close(); return; }
      const result = await session.start(sdp);
      if (reply.raw.destroyed) { await session.close(); return; }
      return result;
    } catch (error) { await session?.close(); return failure(reply, error); }
    finally { reply.raw.off('close', lost); }
  });
  app.get('/copilot/voice/codex/sessions/:id/events', async (req, reply) => {
    try {
      const query = req.query as { spaceId?: unknown; after?: string };
      if (!(await authorize(req, reply, query.spaceId))) return;
      const session = await codexSessions.voiceSession(req.user!.id, query.spaceId as string, (req.params as { id: string }).id);
      return session.events(query.after === undefined ? 0 : /^\d{1,10}$/.test(query.after) ? Number(query.after) : -1);
    } catch (error) { return failure(reply, error); }
  });
  app.post('/copilot/voice/codex/sessions/:id/result', { bodyLimit: 60_000 }, async (req, reply) => {
    try {
      const body = req.body as { spaceId?: unknown; requestId?: unknown } | null;
      if (!(await authorize(req, reply, body?.spaceId))) return;
      if (typeof body?.requestId !== 'string' || body.requestId.length > 100) throw new CodexError(400, 'Invalid voice request.');
      const session = await codexSessions.voiceSession(req.user!.id, body!.spaceId as string, (req.params as { id: string }).id);
      return session.result(body.requestId, body);
    } catch (error) { return failure(reply, error); }
  });
  app.delete('/copilot/voice/codex/sessions/:id', async (req, reply) => {
    try {
      const query = req.query as { spaceId?: unknown };
      if (!(await authorize(req, reply, query.spaceId))) return;
      const session = await codexSessions.voiceSession(req.user!.id, query.spaceId as string, (req.params as { id: string }).id);
      await session.close(); return { stopped: true };
    } catch (error) { return failure(reply, error); }
  });
}
