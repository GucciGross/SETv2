import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { one } from '../db.js';
import { requireSpace, requireUser, rid } from '../lib/http.js';
import { runAgentLoop, resolveApproval, type AgentContext } from './engine.js';

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

    await runAgentLoop({
      spaceId: body.spaceId,
      userId,
      threadId: body.threadId,
      message: body.message,
      context: body.context as AgentContext | undefined,
      requireApprovals: body.requireApprovals,
      systemPrompt: body.systemPrompt,
      emit: (type, payload) => sse(reply, type, payload),
    });

    reply.raw.end();
  });

  app.post('/agent/runs/:id/approve', async (req, reply) => {
    const id = rid((req.params as any).id);
    const body = z.object({ decision: z.enum(['approve', 'reject']) }).parse(req.body);
    const user = await requireUser(req, reply);
    if (!user) return;
    const run = await one<any>(`SELECT * FROM agent_runs WHERE id = $1`, [id]);
    if (!run || run.user_id !== user.id) return reply.code(404).send({ error: 'Run not found' });
    if (!resolveApproval(id, body.decision)) return reply.code(409).send({ error: 'No pending approval (may have timed out)' });
    return { ok: true };
  });
}
