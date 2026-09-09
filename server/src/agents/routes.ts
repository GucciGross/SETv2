import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { one } from '../db.js';
import { requireSpace, requireUser, rid } from '../lib/http.js';
import { runAgentLoop, type AgentContext } from './engine.js';
import { approvalGates } from './approvals.js';

/**
 * Legacy AG-UI style SSE endpoint. The loop itself lives in engine.ts and is
 * shared with the CopilotKit runtime (../copilotkit/). Kept for backwards
 * compatibility, the Slack channel process, and smoke tests.
 */

function sse(reply: FastifyReply, type: string, payload: any) {
  reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export async function agentRoutes(app: FastifyInstance) {
  app.post('/agent/run', async (req, reply) => {
    const body = z
      .object({
        spaceId: z.string(),
        threadId: z.string().optional(),
        message: z.string().min(1),
        context: z
          .object({
            pageId: z.string().optional(),
            notebookId: z.string().optional(),
            modelId: z.string().optional(),
            selection: z.string().optional(),
            view: z.string().optional(),
          })
          .optional(),
        requireApprovals: z.boolean().optional(),
        systemPrompt: z.string().optional(),
      })
      .parse(req.body);
    if (!(await requireSpace(req, reply, body.spaceId))) return;
    const userId = req.user!.id;

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const abort = new AbortController();
    const onClose = () => abort.abort();
    reply.raw.on('close', onClose);
    try {
      await runAgentLoop({
        spaceId: body.spaceId,
        userId,
        threadId: body.threadId,
        message: body.message,
        context: body.context as AgentContext | undefined,
        requireApprovals: body.requireApprovals,
        systemPrompt: body.systemPrompt,
        signal: abort.signal,
        emit: (type, payload) => { if (!reply.raw.destroyed) sse(reply, type, payload); },
      });

    } finally {
      reply.raw.off('close', onClose);
      if (!reply.raw.destroyed) reply.raw.end();
    }
  });

  app.post('/agent/runs/:id/approve', async (req, reply) => {
    const id = rid((req.params as any).id);
    if (!id) return reply.code(400).send({ error: 'Invalid run id' });
    const parsed = z.object({ callId: z.string().min(1).max(256), decision: z.enum(['approve', 'reject']) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'A specific callId and approve/reject decision are required.' });
    const body = parsed.data;
    const user = await requireUser(req, reply);
    if (!user) return;
    const run = await one<any>(`SELECT * FROM agent_runs WHERE id = $1`, [id]);
    if (!run || run.user_id !== user.id) return reply.code(404).send({ error: 'Run not found' });
    if (!(await requireSpace(req, reply, run.space_id, 'editor'))) return;
    const approval = approvalGates.decide(id, body.callId, body.decision);
    if (!approval) return reply.code(409).send({ error: 'This exact action is no longer awaiting approval. Ask Copilot again; no new action was approved.' });
    return { ok: true, callId: body.callId, status: approval.status };
  });

  app.get('/agent/runs/:id/approvals/:callId', async (req, reply) => {
    const id = rid((req.params as any).id);
    if (!id) return reply.code(400).send({ error: 'Invalid run id' });
    const callId = String((req.params as any).callId);
    if (!callId || callId.length > 256) return reply.code(400).send({ error: 'Invalid tool call id' });
    const user = await requireUser(req, reply);
    if (!user) return;
    const run = await one<any>('SELECT user_id, space_id FROM agent_runs WHERE id = $1', [id]);
    if (!run || run.user_id !== user.id) return reply.code(404).send({ error: 'Run not found' });
    if (!(await requireSpace(req, reply, run.space_id))) return;
    const approval = approvalGates.get(id, callId);
    reply.header('Cache-Control', 'no-store');
    return { callId, status: approval?.status ?? 'unavailable', expiresAt: approval?.expiresAt };
  });
}
