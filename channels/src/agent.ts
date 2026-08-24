import { Observable } from 'rxjs';
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/core';
import { AbstractAgent } from '@ag-ui/client';
import { runSetAgent, resolveSpace } from './setApi.js';
import { channelsConfig } from './config.js';

/**
 * AG-UI agent that proxies the SET workspace copilot for Slack turns. Each
 * Slack thread gets a fresh instance (the channel runtime enforces this via
 * the agent factory); SET-side thread continuity is kept per Slack thread id,
 * so a Slack thread maps 1:1 to a SET agent_runs thread.
 */

// slack thread id → SET agent_runs thread id
const setThreads = new Map<string, string>();

export class SetChannelAgent extends AbstractAgent {
  private slackThreadId: string;

  constructor(slackThreadId: string) {
    super({ agentId: 'set-slack', description: 'SET workspace copilot over Slack' });
    this.slackThreadId = slackThreadId;
    this.threadId = slackThreadId;
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    const slackThreadId = this.slackThreadId;
    return new Observable<BaseEvent>((subscriber) => {
      void (async () => {
        const send = (e: BaseEvent) => subscriber.next(e);
        const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
        const text = lastUser ? String((lastUser as any).content ?? '') : '';
        try {
          if (!text.trim()) {
            send({ type: EventType.RUN_ERROR, message: 'No message text in Slack turn' } as BaseEvent);
            subscriber.complete();
            return;
          }

          // Resolve the SET space for this Slack workspace (channel_links, or the
          // deployment's fallback space).
          const platformKey = channelsConfig.fallbackSpaceId ? '' : slackThreadId;
          let spaceId: string | null = null;
          if (platformKey) {
            const res = await resolveSpace(platformKey);
            spaceId = res.spaceId;
          }
          if (!spaceId) spaceId = channelsConfig.fallbackSpaceId || null;
          if (!spaceId) {
            const messageId = crypto.randomUUID();
            send({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent);
            send({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' } as BaseEvent);
            send({
              type: EventType.TEXT_MESSAGE_CONTENT,
              messageId,
              delta:
                "This Slack workspace isn't linked to a SET space yet. " +
                'Ask a SET workspace owner to link it under Settings → Channels ' +
                '(or set CHANNEL_SPACE_ID for the channels service).',
            } as BaseEvent);
            send({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
            send({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId } as BaseEvent);
            subscriber.complete();
            return;
          }

          await runSetAgent({
            spaceId,
            message: text,
            threadId: setThreads.get(slackThreadId) ?? undefined,
            onEvent: (type, payload) => {
              switch (type) {
                case 'RUN_STARTED':
                  if (payload.threadId) setThreads.set(slackThreadId, payload.threadId);
                  send({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent);
                  break;
                case 'TEXT_MESSAGE_START':
                case 'TEXT_MESSAGE_END':
                  // Slack delivery only needs content deltas; the channel runtime
                  // assembles messages from TEXT_MESSAGE_CONTENT streams.
                  break;
                case 'TEXT_MESSAGE_CONTENT': {
                  const messageId = payload.messageId ?? 'slack';
                  send({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' } as BaseEvent);
                  send({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: payload.delta ?? '' } as BaseEvent);
                  send({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
                  break;
                }
                case 'TOOL_CALL_START':
                  send({ type: EventType.TOOL_CALL_START, toolCallId: payload.callId, toolCallName: payload.name } as BaseEvent);
                  send({ type: EventType.TOOL_CALL_ARGS, toolCallId: payload.callId, delta: JSON.stringify(payload.args ?? {}) } as BaseEvent);
                  break;
                case 'TOOL_CALL_END':
                  send({ type: EventType.TOOL_CALL_END, toolCallId: payload.callId } as BaseEvent);
                  break;
                case 'RUN_FINISHED':
                  send({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId } as BaseEvent);
                  break;
                case 'RUN_ERROR':
                  send({ type: EventType.RUN_ERROR, message: payload.message ?? 'SET agent error' } as BaseEvent);
                  break;
                default:
                  break; // CUSTOM a2ui/approval events aren't renderable in Slack
              }
            },
          });
          subscriber.complete();
        } catch (e: any) {
          try {
            send({ type: EventType.RUN_ERROR, message: e?.message ?? String(e) } as BaseEvent);
          } catch {
            /* already closed */
          }
          subscriber.complete();
        }
      })();
      return () => void 0;
    });
  }
}
