import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireSpace, requireUser, rid } from '../lib/http.js';
import { getProvider, chatCompletionStream, ensureBootstrapProvider, type ChatMessage } from '../llm/router.js';
import { getTool, TOOL_DEFS } from './tools.js';

/**
 * AG-UI style agent runtime: streams lifecycle events over SSE
 * (RUN_STARTED, TEXT_MESSAGE_*, TOOL_CALL_*, CUSTOM a2ui/approval, RUN_FINISHED),
 * supports shared state context and human-in-the-loop approvals for write tools.
 */

interface PendingApproval {
  resolve: (decision: 'approve' | 'reject') => void;
  tool: string;
  args: any;
}
const pending = new Map<string, PendingApproval>();

function sse(reply: FastifyReply, type: string, payload: any) {
  reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

const BASE_SYSTEM_PROMPT = `You are SET Copilot — an agent living inside the SET knowledge workspace (pages, graph, databases and research notebooks).
You can read and write workspace pages, search research notebooks with citations, generate study material, and render rich UI components.
Guidelines:
- Prefer tools over guessing: search_workspace before writing about existing content, search_knowledge for research questions.
- When creating content, produce well-structured markdown with headings, lists and [[wiki links]] to related workspace pages.
- Use render_ui (card/table/form) when the answer is better as a component than prose.
- Be concise and helpful. When you used tools, summarize what you did at the end.`;

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
          })
          .optional(),
        requireApprovals: z.boolean().optional(),
      })
      .parse(req.body);
    if (!(await requireSpace(req, reply, body.spaceId))) return;
    const userId = req.user!.id;
    await ensureBootstrapProvider(body.spaceId);

    // thread continuity
    let thread: ChatMessage[] = [];
    let run = await one<any>(
      `INSERT INTO agent_runs (space_id, user_id, thread, status) VALUES ($1, $2, $3, 'running') RETURNING *`,
      [body.spaceId, userId, JSON.stringify([])]
    );
    if (body.threadId) {
      const prev = await one<any>(`SELECT thread FROM agent_runs WHERE id = $1 AND space_id = $2 AND user_id = $3`, [body.threadId, body.spaceId, userId]);
      if (prev?.thread) {
        thread = prev.thread as ChatMessage[];
        await q(`UPDATE agent_runs SET thread = $2 WHERE id = $1`, [run.id, JSON.stringify(thread)]);
      }
    }

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    sse(reply, 'RUN_STARTED', { threadId: body.threadId ?? run.id, runId: run.id });
    // shared state snapshot (AG-UI STATE_SNAPSHOT analog)
    sse(reply, 'STATE_SNAPSHOT', { context: body.context ?? {} });

    const provider = await getProvider(body.spaceId);
    const settings = await one<{ data: any }>(`SELECT data FROM settings WHERE space_id = $1`, [body.spaceId]);
    const approvals = body.requireApprovals ?? settings?.data?.agentApprovals ?? false;

    let contextBlock = '';
    if (body.context?.pageId) {
      const page = await one<any>(`SELECT title, markdown FROM pages WHERE id = $1`, [body.context.pageId]);
      if (page) contextBlock += `Current page: "${page.title}"\n\n${page.markdown.slice(0, 4000)}\n\n`;
    }
    if (body.context?.notebookId) {
      const nb = await one<any>(`SELECT title FROM notebooks WHERE id = $1`, [body.context.notebookId]);
      if (nb) contextBlock += `Current notebook: "${nb.title}" (id ${nb.id}) — use search_knowledge with this notebookId.\n\n`;
    }
    if (body.context?.selection) contextBlock += `User selection: "${body.context.selection.slice(0, 1000)}"\n\n`;

    thread.push({ role: 'user', content: body.message });

    const toolLog: any[] = [];

    if (!provider) {
      const msg =
        ' No LLM provider configured yet. Go to **Settings  AI Providers** and add one (Ollama at `http://localhost:11434/v1`, LM Studio, or any OpenAI-compatible endpoint).';
      sse(reply, 'TEXT_MESSAGE_CONTENT', { delta: msg });
      sse(reply, 'RUN_FINISHED', { threadId: body.threadId ?? run.id });
      await q(`UPDATE agent_runs SET thread = $2, status = 'finished' WHERE id = $1`, [run.id, JSON.stringify(thread)]);
      reply.raw.end();
      return;
    }

    try {
      const MAX_STEPS = 8;
      for (let step = 0; step < MAX_STEPS; step++) {
        const { getActiveSkillPrompt } = await import('../skills/routes.js');
        const skillPrompt = await getActiveSkillPrompt(body.spaceId);
        const systemContent = skillPrompt ? `${BASE_SYSTEM_PROMPT}

# Active Skills
${skillPrompt}` : BASE_SYSTEM_PROMPT;
        const messages: ChatMessage[] = [
          { role: 'system', content: systemContent },
          ...(contextBlock && step === 0 ? ([{ role: 'system', content: contextBlock }] as ChatMessage[]) : []),
          ...thread.slice(-16),
        ];
        let assistantContent = '';
        const result = await chatCompletionStream(provider, null, { messages, tools: TOOL_DEFS }, (delta) => {
          assistantContent += delta;
          sse(reply, 'TEXT_MESSAGE_CONTENT', { delta });
        });

        if (!result.tool_calls.length) {
          thread.push({ role: 'assistant', content: result.content ?? '' });
          break;
        }

        thread.push({
          role: 'assistant',
          content: result.content,
          tool_calls: result.tool_calls,
        } as ChatMessage);

        for (const tc of result.tool_calls) {
          const tool = getTool(tc.function.name);
          let args: any = {};
          try {
            args = JSON.parse(tc.function.arguments || '{}');
          } catch {
            /* empty args */
          }
          sse(reply, 'TOOL_CALL_START', { callId: tc.id, name: tc.function.name, args });

          if (!tool) {
            const err = { error: `Unknown tool ${tc.function.name}` };
            sse(reply, 'TOOL_CALL_END', { callId: tc.id, name: tc.function.name, ok: false, result: err });
            thread.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(err) } as ChatMessage);
            toolLog.push({ name: tc.function.name, args, ok: false, result: err });
            continue;
          }

          // Human-in-the-loop gate for write tools
          if (tool.write && approvals) {
            await q(`UPDATE agent_runs SET status = 'awaiting_approval' WHERE id = $1`, [run.id]);
            sse(reply, 'CUSTOM', {
              subtype: 'approval_request',
              runId: run.id,
              callId: tc.id,
              tool: tc.function.name,
              args,
            });
            const decision = await new Promise<'approve' | 'reject'>((resolve) => {
              const timer = setTimeout(() => {
                pending.delete(run.id);
                resolve('reject');
              }, 180_000);
              pending.set(run.id, {
                resolve: (d) => {
                  clearTimeout(timer);
                  pending.delete(run.id);
                  resolve(d);
                },
                tool: tc.function.name,
                args,
              });
            });
            if (decision === 'reject') {
              const res = { rejected: true, note: 'The user rejected this action.' };
              sse(reply, 'TOOL_CALL_END', { callId: tc.id, name: tc.function.name, ok: false, result: res });
              thread.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(res) } as ChatMessage);
              toolLog.push({ name: tc.function.name, args, rejected: true });
              await q(`UPDATE agent_runs SET status = 'running' WHERE id = $1`, [run.id]);
              continue;
            }
            await q(`UPDATE agent_runs SET status = 'running' WHERE id = $1`, [run.id]);
          }

          try {
            const out = await tool.run(args, { spaceId: body.spaceId, userId, provider });
            sse(reply, 'TOOL_CALL_END', { callId: tc.id, name: tc.function.name, ok: out.ok, result: out.result });
            if (out.a2ui?.length) sse(reply, 'CUSTOM', { subtype: 'a2ui', components: out.a2ui });
            thread.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(out.result).slice(0, 12000) } as ChatMessage);
            toolLog.push({ name: tc.function.name, args, ok: out.ok, result: out.result });
          } catch (e: any) {
            const res = { error: e.message ?? String(e) };
            sse(reply, 'TOOL_CALL_END', { callId: tc.id, name: tc.function.name, ok: false, result: res });
            thread.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(res) } as ChatMessage);
            toolLog.push({ name: tc.function.name, args, ok: false, result: res });
          }
        }
        // loop continues: model sees tool results and may stream more text or call more tools
      }

      sse(reply, 'RUN_FINISHED', { threadId: body.threadId ?? run.id, runId: run.id });
      await q(`UPDATE agent_runs SET thread = $2, status = 'finished', tool_log = $3 WHERE id = $1`, [run.id, JSON.stringify(thread), JSON.stringify(toolLog)]);
    } catch (e: any) {
      sse(reply, 'RUN_ERROR', { message: e.message ?? String(e) });
      await q(`UPDATE agent_runs SET status = 'error' WHERE id = $1`, [run.id]);
    }
    reply.raw.end();
  });

  app.post('/agent/runs/:id/approve', async (req, reply) => {
    const id = rid((req.params as any).id);
    const body = z.object({ decision: z.enum(['approve', 'reject']) }).parse(req.body);
    const user = await requireUser(req, reply);
    if (!user) return;
    const run = await one<any>(`SELECT * FROM agent_runs WHERE id = $1`, [id]);
    if (!run || run.user_id !== user.id) return reply.code(404).send({ error: 'Run not found' });
    const p = pending.get(id);
    if (!p) return reply.code(409).send({ error: 'No pending approval (may have timed out)' });
    p.resolve(body.decision);
    return { ok: true };
  });
}
