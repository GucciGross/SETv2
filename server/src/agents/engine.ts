import { one, q } from '../db.js';
import { getProvider, chatCompletionStream, ensureBootstrapProvider, type ChatMessage, type ToolDef } from '../llm/router.js';
import { getTool, TOOL_DEFS } from './tools.js';

/**
 * Shared agent engine used by every entry point:
 *  - the legacy SSE endpoint (agents/routes.ts POST /agent/run)
 *  - the CopilotKit AG-UI runtime (copilotkit/agent.ts)
 *  - the Slack channel process (via the legacy endpoint over HTTP)
 *
 * Emits AG-UI-shaped lifecycle events through a caller-supplied `emit`
 * callback: RUN_STARTED, STATE_SNAPSHOT, TEXT_MESSAGE_START/CONTENT/END,
 * TOOL_CALL_START/END, CUSTOM (a2ui / approval_request), CLIENT_TOOL_CALL,
 * RUN_FINISHED, RUN_ERROR.
 */

export const BASE_SYSTEM_PROMPT = `You are SET Copilot — an agent living inside the SET knowledge workspace (pages, graph, databases and research notebooks).
You can read and write workspace pages, search research notebooks with citations, generate study material, and render rich UI components.
You can also see and (with the user's approval) operate native desktop apps on their machine: screen_capture returns an annotated capture (screenshot + numbered element index with pixel bounds), screen_act clicks/types/scrolls by element_index — always capture before acting, and tell the user what you are about to do on their screen.
Guidelines:
- Prefer tools over guessing: search_workspace before writing about existing content, search_knowledge for research questions.
- When creating content, produce well-structured markdown with headings, lists and [[wiki links]] to related workspace pages.
- Use render_ui (card/table/form) when the answer is better as a component than prose.
- Be concise and helpful. When you used tools, summarize what you did at the end.`;

export interface AgentContext {
  pageId?: string;
  notebookId?: string;
  modelId?: string;
  selection?: string;
  view?: string;
  /** Free-form description of what the user is looking at (CopilotKit useAgentContext entries). */
  screen?: string;
}

export interface PendingApproval {
  resolve: (decision: 'approve' | 'reject') => void;
  tool: string;
  args: any;
}

// In-memory approval gates shared by all entry points; resolved via the
// REST endpoint POST /agent/runs/:id/approve (same process).
const pending = new Map<string, PendingApproval>();

export function resolveApproval(runId: string, decision: 'approve' | 'reject'): boolean {
  const p = pending.get(runId);
  if (!p) return false;
  p.resolve(decision);
  return true;
}

export type EmitFn = (type: string, payload?: any) => void;

export interface RunAgentLoopOptions {
  spaceId: string;
  userId: string;
  /** agent_runs row id to continue (db history mode). */
  threadId?: string;
  message: string;
  context?: AgentContext;
  requireApprovals?: boolean;
  systemPrompt?: string;
  /** Schemas of client-side (frontend) tools the model may call; execution happens on the client. */
  extraTools?: ToolDef[];
  /** 'db' (default) keeps thread history in agent_runs; 'messages' uses the supplied historyMessages (CopilotKit guide mode). */
  history?: 'db' | 'messages';
  historyMessages?: ChatMessage[];
  /** Where this run came from — used for anonymous telemetry counters. */
  source?: 'copilot' | 'guide' | 'slack' | 'api';
  emit: EmitFn;
  signal?: AbortSignal;
}

/**
 * Providers are strict about message sequences — GLM answers 400 "messages
 * parameter is illegal" (code 1214) for any of: a tool result whose
 * tool_call was never declared, an assistant tool_calls turn whose results
 * got cut off (the -16 window does this as threads grow), empty content, or
 * empty tool_call ids. Runs that errored mid-tool-call poison the stored
 * thread, and then EVERY later run on that thread 400s. Sanitize the window
 * into a legal sequence; orphaned tool-call turns are rewritten as plain
 * assistant text (dropped when they have none) so the thread survives.
 */
export function sanitizeMessages(input: ChatMessage[]): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  for (const m of input) {
    const content = (m.content ?? '').toString();
    if (m.role === 'system' || m.role === 'user') {
      if (content.trim()) msgs.push({ role: m.role, content });
      continue;
    }
    if (m.role === 'assistant') {
      const toolCalls = Array.isArray(m.tool_calls)
        ? m.tool_calls
            .filter((tc: any) => tc?.function?.name)
            .map((tc: any, i: number) => ({
              id: typeof tc.id === 'string' && tc.id ? tc.id : `call_${i}`,
              type: 'function' as const,
              function: {
                name: String(tc.function.name),
                arguments:
                  typeof tc.function.arguments === 'string' && tc.function.arguments ? tc.function.arguments : '{}',
              },
            }))
        : [];
      if (toolCalls.length) msgs.push({ role: 'assistant', content, tool_calls: toolCalls });
      else if (content.trim()) msgs.push({ role: 'assistant', content });
      continue;
    }
    msgs.push({ role: 'tool', content, tool_call_id: (m.tool_call_id ?? '').toString(), name: m.name });
  }

  // Tool results must follow their declaration, and every declared tool_call
  // must be resolved before the next non-tool message — rewrite violations
  // as plain assistant text.
  const out: ChatMessage[] = [];
  let pending = new Set<string>();
  let lastAssistant = -1;
  const resolveAssistant = () => {
    if (!pending.size || lastAssistant < 0) return;
    const m = out[lastAssistant];
    const text = (m.content ?? '').toString().trim();
    if (text) out[lastAssistant] = { role: 'assistant', content: text };
    else out.splice(lastAssistant, 1);
    pending = new Set();
    lastAssistant = -1;
  };
  for (const m of msgs) {
    if (m.role === 'assistant' && m.tool_calls?.length) {
      resolveAssistant();
      out.push(m);
      lastAssistant = out.length - 1;
      pending = new Set(m.tool_calls.map((tc: any) => tc.id));
      continue;
    }
    if (m.role === 'tool') {
      if (m.tool_call_id && pending.has(m.tool_call_id)) {
        out.push(m);
        pending.delete(m.tool_call_id);
      }
      continue; // orphaned result — drop
    }
    resolveAssistant();
    // merge consecutive plain assistant messages (some providers reject them)
    const prev = out[out.length - 1];
    if (m.role === 'assistant' && prev?.role === 'assistant' && !prev.tool_calls?.length) {
      prev.content = `${prev.content}\n\n${m.content}`.trim();
      continue;
    }
    out.push(m);
  }
  resolveAssistant();
  return out;
}

export async function runAgentLoop(opts: RunAgentLoopOptions): Promise<void> {  const { spaceId, userId, message, emit, signal } = opts;
  console.log(`[engine] runAgentLoop space=${spaceId} source=${opts.source ?? 'api'} msg="${message.slice(0, 60)}"`);
  const historyMode = opts.history ?? 'db';
  await ensureBootstrapProvider(spaceId);
  const { telemetry } = await import('../telemetry/index.js');
  telemetry.track(`agent_run_${opts.source ?? 'api'}`);

  // Thread continuity. CopilotKit clients send their own thread ids (not our
  // uuids); runs store client_thread_id for continuity. Legacy callers pass a
  // previous run's uuid — matched by id.
  const isUuid = (v?: string) => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const clientThreadId = historyMode === 'db' && opts.threadId && !isUuid(opts.threadId) ? opts.threadId : null;
  let thread: ChatMessage[] = [];
  let run = await one<any>(
    `INSERT INTO agent_runs (space_id, user_id, thread, status, client_thread_id) VALUES ($1, $2, $3, 'running', $4) RETURNING *`,
    [spaceId, userId, JSON.stringify([]), clientThreadId]
  );
  if (historyMode === 'db' && opts.threadId) {
    const prev = clientThreadId
      ? await one<any>(
          `SELECT thread FROM agent_runs WHERE client_thread_id = $1 AND space_id = $2 AND user_id = $3 ORDER BY created_at DESC LIMIT 1`,
          [clientThreadId, spaceId, userId]
        )
      : await one<any>(`SELECT thread FROM agent_runs WHERE id = $1 AND space_id = $2 AND user_id = $3`, [opts.threadId, spaceId, userId]);
    if (prev?.thread) {
      thread = prev.thread as ChatMessage[];
      await q(`UPDATE agent_runs SET thread = $2 WHERE id = $1`, [run.id, JSON.stringify(thread)]);
    }
  } else if (historyMode === 'messages' && opts.historyMessages?.length) {
    thread = opts.historyMessages.slice(-24);
  }

  const threadId = opts.threadId ?? run.id;
  emit('RUN_STARTED', { threadId, runId: run.id });
  emit('STATE_SNAPSHOT', { context: opts.context ?? {} });

  const provider = await getProvider(spaceId);
  const settings = await one<{ data: any }>(`SELECT data FROM settings WHERE space_id = $1`, [spaceId]);
  const approvals = opts.requireApprovals ?? settings?.data?.agentApprovals ?? false;

  let contextBlock = '';
  if (opts.context?.view) contextBlock += `Current screen: ${opts.context.view}\n\n`;
  if (opts.context?.screen) contextBlock += `What the user is looking at:\n${opts.context.screen.slice(0, 4000)}\n\n`;
  if (isUuid(opts.context?.pageId)) {
    const page = await one<any>(`SELECT title, markdown FROM pages WHERE id = $1`, [opts.context!.pageId]);
    if (page) contextBlock += `Current page: "${page.title}"\n\n${page.markdown.slice(0, 4000)}\n\n`;
  }
  if (isUuid(opts.context?.notebookId)) {
    const nb = await one<any>(`SELECT title FROM notebooks WHERE id = $1`, [opts.context!.notebookId]);
    if (nb) contextBlock += `Current notebook: "${nb.title}" (id ${nb.id}) — use search_knowledge with this notebookId.\n\n`;
  }
  if (opts.context?.selection) contextBlock += `User selection: "${opts.context.selection.slice(0, 1000)}"\n\n`;

  if (historyMode === 'db') thread.push({ role: 'user', content: message });

  const toolLog: any[] = [];
  const extraToolDefs = opts.extraTools?.length ? opts.extraTools : [];
  const allTools = [...TOOL_DEFS, ...extraToolDefs];
  const extraNames = new Set(extraToolDefs.map((t) => t.function.name));

  const persist = async (status: string) => {
    await q(`UPDATE agent_runs SET thread = $2, status = $3, tool_log = $4 WHERE id = $1`, [
      run.id,
      JSON.stringify(thread),
      status,
      JSON.stringify(toolLog),
    ]);
  };

  if (!provider) {
    const msg =
      ' No LLM provider configured yet. Go to **Settings  AI Providers** and add one (Ollama at `http://localhost:11434/v1`, LM Studio, or any OpenAI-compatible endpoint).';
    const messageId = crypto.randomUUID();
    emit('TEXT_MESSAGE_START', { messageId });
    emit('TEXT_MESSAGE_CONTENT', { messageId, delta: msg });
    emit('TEXT_MESSAGE_END', { messageId });
    emit('RUN_FINISHED', { threadId, runId: run.id });
    await persist('finished');
    return;
  }

  try {
    const MAX_STEPS = 16;
    let clientToolCalled = false;

    for (let step = 0; step < MAX_STEPS && !clientToolCalled; step++) {
      if (signal?.aborted) break;
      const { getActiveSkillPrompt } = await import('../skills/routes.js');
      const skillPrompt = await getActiveSkillPrompt(spaceId);
      const base = opts.systemPrompt ?? BASE_SYSTEM_PROMPT;
      const systemContent = skillPrompt ? `${base}\n\n# Active Skills\n${skillPrompt}` : base;
      const messages: ChatMessage[] = [
        { role: 'system', content: systemContent },
        ...(contextBlock && step === 0 ? ([{ role: 'system', content: contextBlock }] as ChatMessage[]) : []),
        ...sanitizeMessages(thread.slice(-16)),
      ];
      let assistantContent = '';
      let messageId: string | null = null;
      const result = await chatCompletionStream(
        provider,
        null,
        { messages, tools: allTools.length ? allTools : undefined, signal },
        (delta) => {
          if (!messageId) {
            messageId = crypto.randomUUID();
            emit('TEXT_MESSAGE_START', { messageId });
          }
          assistantContent += delta;
          emit('TEXT_MESSAGE_CONTENT', { messageId, delta });
        }
      );
      if (messageId) emit('TEXT_MESSAGE_END', { messageId });

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
        emit('TOOL_CALL_START', { callId: tc.id, name: tc.function.name, args });

        // Client-side (frontend) tool: CopilotKit executes it in the browser and
        // re-runs with the result appended — end this run after emitting.
        // The placeholder must be exactly "Forwarded to client": that string is
        // what CopilotKit's client matches (isFrontendPlaceholderResult) before
        // it strips the stub, runs the real handler, and continues the run.
        if (!tool && extraNames.has(tc.function.name)) {
          emit('TOOL_CALL_END', { callId: tc.id, name: tc.function.name, ok: true, result: 'Forwarded to client' });
          toolLog.push({ name: tc.function.name, args, delegated: true });
          clientToolCalled = true;
          continue;
        }

        if (!tool) {
          const err = { error: `Unknown tool ${tc.function.name}` };
          emit('TOOL_CALL_END', { callId: tc.id, name: tc.function.name, ok: false, result: err });
          thread.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(err) } as ChatMessage);
          toolLog.push({ name: tc.function.name, args, ok: false, result: err });
          continue;
        }

        // Human-in-the-loop gate for write tools
        if (tool.write && approvals) {
          await q(`UPDATE agent_runs SET status = 'awaiting_approval' WHERE id = $1`, [run.id]);
          emit('CUSTOM', {
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
            emit('TOOL_CALL_END', { callId: tc.id, name: tc.function.name, ok: false, result: res });
            thread.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(res) } as ChatMessage);
            toolLog.push({ name: tc.function.name, args, rejected: true });
            await q(`UPDATE agent_runs SET status = 'running' WHERE id = $1`, [run.id]);
            continue;
          }
          await q(`UPDATE agent_runs SET status = 'running' WHERE id = $1`, [run.id]);
        }

        try {
          const out = await tool.run(args, { spaceId, userId, provider });
          // The emitted event must stay small: strip inline screenshots (the
          // full result with data-URL still reaches the model via the thread).
          const emitted = out.result && typeof out.result === 'object'
            ? { ...out.result, screenshot: undefined, hasScreenshot: !!out.result.screenshot }
            : out.result;
          emit('TOOL_CALL_END', { callId: tc.id, name: tc.function.name, ok: out.ok, result: emitted });
          if (out.a2ui?.length) emit('CUSTOM', { subtype: 'a2ui', components: out.a2ui });
          thread.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(out.result).slice(0, 12000) } as ChatMessage);
          toolLog.push({ name: tc.function.name, args, ok: out.ok, result: out.result });
        } catch (e: any) {
          const res = { error: e.message ?? String(e) };
          emit('TOOL_CALL_END', { callId: tc.id, name: tc.function.name, ok: false, result: res });
          thread.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(res) } as ChatMessage);
          toolLog.push({ name: tc.function.name, args, ok: false, result: res });
        }
      }
      // loop continues: model sees tool results and may stream more text or call more tools
    }

    emit('RUN_FINISHED', { threadId, runId: run.id });
    await persist('finished');
  } catch (e: any) {
    emit('RUN_ERROR', { message: e.message ?? String(e) });
    await q(`UPDATE agent_runs SET status = 'error' WHERE id = $1`, [run.id]);
  }
}
