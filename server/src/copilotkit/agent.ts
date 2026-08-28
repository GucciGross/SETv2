import { Observable } from 'rxjs';
import type { BaseEvent, RunAgentInput, Message } from '@ag-ui/core';
import { EventType } from '@ag-ui/core';
import { AbstractAgent } from '@ag-ui/client';
import { one } from '../db.js';
import type { ChatMessage, ToolDef } from '../llm/router.js';
import { runAgentLoop, BASE_SYSTEM_PROMPT, type AgentContext } from '../agents/engine.js';

/**
 * AG-UI adapter over the shared SET agent engine. Registered on the
 * CopilotKit runtime; one instance per HTTP request (the runtime factory
 * passes the authenticated user through).
 *
 * Two agents share this class:
 *  - "set"       — the workspace copilot (db thread history, server tools)
 *  - "set_guide" — the on-screen guide (client-provided history + frontend tools)
 */

const GUIDE_SYSTEM_PROMPT = `You are the SET Guide — a friendly on-screen assistant living inside the SET knowledge workspace.
Your job is to help the person use SET *while they use it*:
- Explain what is on the current screen when asked ("what am I looking at?").
- Help fill out notes: draft content and insert it with the insert_into_editor tool rather than dumping text in chat.
- Teach SET features as they become relevant; use highlight_element to spotlight UI and start_tour for the full walkthrough.
- Move the user around with navigate when they ask where something is.
Guidelines:
- You see a description of the current screen in the context. Refer to actual UI elements by name.
- Prefer one clear action over long explanations. Keep replies short (1-4 sentences) unless asked to elaborate.
- When the user seems new, suggest the natural next step.
- Server tools (search_workspace, read_page, search_knowledge, …) are available when deeper workspace knowledge helps.`;

export interface SetAgentUser {
  id: string;
  name: string;
}

export class SetAgent extends AbstractAgent {
  private user: SetAgentUser;
  private guide: boolean;

  constructor(user: SetAgentUser, opts?: { guide?: boolean; agentId?: string; description?: string }) {
    super({
      agentId: opts?.agentId ?? (opts?.guide ? 'set_guide' : 'set'),
      description: opts?.description ?? (opts?.guide ? 'SET on-screen guide' : 'SET workspace copilot'),
    });
    this.user = user;
    this.guide = !!opts?.guide;
  }

  /**
   * The runtime clones agents per turn; the base clone() only copies base-class
   * fields, so carry the authenticated user + mode over or the clone loses them.
   */
  clone(): this {
    const c = super.clone() as this;
    (c as any).user = this.user;
    (c as any).guide = this.guide;
    return c;
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    const user = this.user;
    const guide = this.guide;
    const abort = new AbortController();
    console.log(`[set-agent] run() agentId=${this.agentId} guide=${guide} threadId=${input.threadId} msgs=${input.messages?.length ?? 0} fwdProps=${JSON.stringify(input.forwardedProps ?? {}).slice(0, 200)}`);

    return new Observable<BaseEvent>((subscriber) => {
      void (async () => {
        const threadId = input.threadId;
        const runId = input.runId;
        const send = (e: BaseEvent) => subscriber.next(e);

        try {
          const fp = (input.forwardedProps ?? {}) as { spaceId?: string; context?: AgentContext };
          const spaceId = fp.spaceId;
          if (!spaceId) throw new Error('No spaceId provided (forwardedProps.spaceId)');

          // Membership gate — parity with the legacy requireSpace guard.
          const membership = await one<any>(
            `SELECT role FROM memberships WHERE user_id = $1 AND space_id = $2`,
            [user.id, spaceId]
          );
          if (!membership) throw new Error('You are not a member of this workspace');

          const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
          const message = lastUser ? messageText(lastUser) : '';
          if (!message.trim()) throw new Error('No user message in run');

          // useAgentContext entries (Context {description, value}) describe the
          // screen. Structured values (JSON from useSetScreenContext) lift known
          // ids into the engine context so it can load the real page content.
          const context: AgentContext = {
            ...((fp.context as AgentContext) ?? {}),
          };
          for (const c of input.context ?? []) {
            if (!c?.description) continue;
            try {
              const parsed = JSON.parse(c.value);
              if (parsed && typeof parsed === 'object') {
                for (const key of ['pageId', 'notebookId', 'modelId', 'view'] as const) {
                  const v = parsed[key];
                  if (typeof v === 'string' && v && !(context as any)[key]) (context as any)[key] = v;
                }
              }
            } catch {
              /* plain-text context */
            }
          }
          const screen = (input.context ?? [])
            .filter((c) => c?.description)
            .map((c) => `- ${c.description}: ${c.value}`)
            .join('\n');
          if (screen) context.screen = screen;

          // AG-UI runtimes validate stream completeness: RUN_FINISHED with a
          // text message still open is rejected (INCOMPLETE_STREAM) and the
          // client silently drops the whole run. When the model goes straight
          // to tool calls with no text, the engine emits no TEXT_MESSAGE_*
          // envelope at all — so we synthesize one around tool-only turns.
          // State must live HERE, outside the emit callback (which is invoked
          // once per event).
          let syntheticMessageId: string | null = null;
          const closeSynthetic = () => {
            if (syntheticMessageId) {
              send({ type: EventType.TEXT_MESSAGE_END, messageId: syntheticMessageId } as BaseEvent);
              syntheticMessageId = null;
            }
          };

          await runAgentLoop({
            spaceId,
            userId: user.id,
            threadId,
            message,
            context,
            systemPrompt: guide ? GUIDE_SYSTEM_PROMPT : BASE_SYSTEM_PROMPT,
            source: guide ? 'guide' : 'copilot',
            ...(guide
              ? {
                  history: 'messages' as const,
                  historyMessages: translateMessages(input.messages),
                  extraTools: translateTools(input.tools ?? []),
                }
              : {}),
            signal: abort.signal,
            emit: (type: string, payload: any) => {
              switch (type) {
                case 'RUN_STARTED':
                  send({ type: EventType.RUN_STARTED, threadId, runId } as BaseEvent);
                  break;
                case 'STATE_SNAPSHOT':
                  send({ type: EventType.STATE_SNAPSHOT, threadId, snapshot: payload.context ?? {} } as BaseEvent);
                  break;
                case 'TEXT_MESSAGE_START':
                  closeSynthetic();
                  send({ type: EventType.TEXT_MESSAGE_START, messageId: payload.messageId, role: 'assistant' } as BaseEvent);
                  break;
                case 'TEXT_MESSAGE_CONTENT':
                  send({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: payload.messageId, delta: payload.delta } as BaseEvent);
                  break;
                case 'TEXT_MESSAGE_END':
                  send({ type: EventType.TEXT_MESSAGE_END, messageId: payload.messageId } as BaseEvent);
                  break;
                case 'TOOL_CALL_START':
                  if (!syntheticMessageId) {
                    syntheticMessageId = `tc-${payload.callId}`;
                    send({ type: EventType.TEXT_MESSAGE_START, messageId: syntheticMessageId, role: 'assistant' } as BaseEvent);
                  }
                  send({ type: EventType.TOOL_CALL_START, toolCallId: payload.callId, toolCallName: payload.name } as BaseEvent);
                  send({ type: EventType.TOOL_CALL_ARGS, toolCallId: payload.callId, delta: JSON.stringify(payload.args ?? {}) } as BaseEvent);
                  break;
                case 'TOOL_CALL_END':
                  send({ type: EventType.TOOL_CALL_END, toolCallId: payload.callId } as BaseEvent);
                  // messageId is REQUIRED on TOOL_CALL_RESULT (AG-UI schema);
                  // without it the client's apply wedges and the whole run
                  // silently stops rendering. It must reference the assistant
                  // message carrying the tool call — our synthetic envelope.
                  send({
                    type: EventType.TOOL_CALL_RESULT,
                    messageId: syntheticMessageId ?? `tc-${payload.callId}`,
                    toolCallId: payload.callId,
                    role: 'tool',
                    // strings go out verbatim — CopilotKit's client matches the
                    // delegated-tool placeholder "Forwarded to client" exactly,
                    // and JSON-quoting would break that comparison
                    content:
                      typeof payload.result === 'string'
                        ? payload.result
                        : JSON.stringify(payload.result ?? null).slice(0, 4000),
                  } as BaseEvent);
                  break;
                case 'CUSTOM':
                  send({ type: EventType.CUSTOM, name: payload.subtype ?? 'set', value: payload } as BaseEvent);
                  break;
                case 'RUN_FINISHED':
                  closeSynthetic();
                  send({ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent);
                  break;
                case 'RUN_ERROR':
                  closeSynthetic();
                  send({ type: EventType.RUN_ERROR, message: payload.message ?? 'Unknown error' } as BaseEvent);
                  break;
                default:
                  break; // CLIENT_TOOL_CALL etc. already surface through TOOL_CALL_* events
              }
            },
          });
          subscriber.complete();
        } catch (e: any) {
          try {
            subscriber.next({ type: EventType.RUN_ERROR, message: e?.message ?? String(e) } as BaseEvent);
          } catch {
            /* subscriber already closed */
          }
          subscriber.complete();
        }
      })();

      return () => abort.abort();
    });
  }
}

/** AG-UI messages (camelCase toolCalls) → OpenAI-style ChatMessages (snake_case). */
export function translateMessages(messages: Message[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'assistant') {
      const anyM = m as any;
      out.push({
        role: 'assistant',
        content: typeof m.content === 'string' ? m.content : messageText(m),
        ...(anyM.toolCalls?.length
          ? {
              tool_calls: anyM.toolCalls.map((tc: any) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.function?.name ?? tc.name, arguments: tc.function?.arguments ?? tc.arguments ?? '{}' },
              })),
            }
          : {}),
      });
    } else if (m.role === 'tool') {
      const anyM = m as any;
      out.push({
        role: 'tool',
        tool_call_id: anyM.toolCallId ?? anyM.tool_call_id ?? '',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(anyM.content ?? ''),
      } as ChatMessage);
    } else if (m.role === 'user' || m.role === 'system') {
      out.push({ role: m.role, content: messageText(m) });
    }
    // developer messages are folded away
  }
  return out;
}

function messageText(m: Message): string {
  const c = (m as any).content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((p: any) => (typeof p === 'string' ? p : p?.type === 'text' ? p.text : ''))
      .join('')
      .trim();
  }
  return '';
}

/** AG-UI Tool schemas (frontend tools) → OpenAI tool defs for the LLM call. */
function translateTools(tools: RunAgentInput['tools']): ToolDef[] {
  return (tools ?? [])
    .filter((t) => t?.name)
    .map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description ?? '', parameters: t.parameters ?? { type: 'object', properties: {} } },
    }));
}
