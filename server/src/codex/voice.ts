import { randomUUID } from 'node:crypto';
import { CodexError, codexVoiceEnabled, requireCodexVoice } from './policy.js';
import type { CodexRpc, RpcId, RpcMessage } from './rpc.js';

export const VOICE_LIMITS = { sdp: 64_000, text: 12_000, events: 128, requests: 32, idleMs: 45_000, lifetimeMs: 600_000 };
export interface VoiceResult { success: boolean; text: string }
export type VoiceEvent = { sequence: number } & (
  { type: 'request'; requestId: string; text: string } |
  { type: 'transcript'; text: string }
);

export function voiceOffer(value: unknown): string {
  if (typeof value !== 'string' || value.length > VOICE_LIMITS.sdp || !value.startsWith('v=0') ||
      !/(?:\r?\n)m=audio /.test(value)) throw new CodexError(400, 'A bounded WebRTC audio offer is required.');
  return value;
}
export function voiceResult(value: unknown): VoiceResult {
  const v = value as Partial<VoiceResult> | null;
  if (!v || typeof v.success !== 'boolean' || typeof v.text !== 'string' || !v.text.trim() || v.text.length > VOICE_LIMITS.text) {
    throw new CodexError(400, 'A bounded Copilot result is required.');
  }
  return { success: v.success, text: v.text };
}

const INSTRUCTIONS = `You are the spoken interface to SET Copilot. For every substantive question or requested action, call set_copilot with the user's request. The tool runs the existing SET chat, screen context, tools and approval policy. It is the only authority for workspace facts and actions. Do not answer those requests independently, claim success before its result, or repeat a refused action. You may acknowledge the request briefly while it runs. Explain approval requests as needing review in the visible Copilot chat. Speak the returned answer naturally, preserving failures and uncertainty. Never use native tools, shell, filesystem, MCP, web or other agents.`;

/**
 * Audio/signaling adapter, NOT another SET tool executor. Its only dynamic tool
 * hands work to the existing visible CopilotKit conversation. The CLI owns auth
 * and model selection; this class never reads credentials or calls a paid API.
 * Protocol: openai/codex rust-v0.154.0, v2/realtime.rs (experimental).
 */
export class CodexVoice {
  readonly id = randomUUID();
  private threadId = '';
  private turnId = '';
  private closed = false;
  private closing?: Promise<void>;
  private sequence = 0;
  private queue: VoiceEvent[] = [];
  private calls = 0;
  private pending = new Map<string, RpcId>();
  private completed = new Map<string, string>();
  private requestIds = new Set<RpcId>();
  private lastPoll = Date.now();
  private deadline: NodeJS.Timeout;
  private heartbeat: NodeJS.Timeout;
  private removeHandler: () => void;
  private resolveSdp?: (sdp: string) => void;
  private rejectSdp?: (error: Error) => void;

  constructor(private readonly rpc: CodexRpc, private readonly workDir: string,
    readonly spaceId: string, private readonly release: (healthy: boolean) => void,
    limits = { idleMs: VOICE_LIMITS.idleMs, lifetimeMs: VOICE_LIMITS.lifetimeMs }) {
    this.deadline = setTimeout(() => void this.close(), limits.lifetimeMs);
    this.heartbeat = setInterval(() => {
      if (!codexVoiceEnabled() || Date.now() - this.lastPoll > limits.idleMs) void this.close();
    }, Math.min(5_000, limits.idleMs));
    this.deadline.unref(); this.heartbeat.unref();
    this.removeHandler = rpc.addServerRequestHandler(this.serverRequest);
    rpc.events.on('notification', this.notification);
    rpc.events.on('closed', this.disconnected);
  }

  private assertActive() {
    requireCodexVoice();
    if (this.closed) throw new CodexError(410, 'The voice session ended. Start voice again or use text.');
  }

  async start(offer: string): Promise<{ sessionId: string; sdp: string }> {
    this.assertActive(); voiceOffer(offer);
    // Install SDP/error listeners before either request: notifications can arrive
    // in the same NDJSON chunk as the RPC response.
    const answer = new Promise<string>((resolve, reject) => { this.resolveSdp = resolve; this.rejectSdp = reject; });
    void answer.catch(() => {});
    const timeout = setTimeout(() => {
      this.rejectSdp?.(new CodexError(504, 'Codex voice did not connect. Check voice access and CLI compatibility. No API fallback was used.'));
    }, 25_000);
    try {
      const started = await this.rpc.request('thread/start', {
        cwd: this.workDir, sandbox: 'readOnly', approvalPolicy: 'never', ephemeral: true,
        developerInstructions: INSTRUCTIONS,
        dynamicTools: [{ type: 'function', name: 'set_copilot', description: 'Ask the existing SET Copilot chat to answer or perform the user request with its normal permissions and approvals.',
          inputSchema: { type: 'object', properties: { request: { type: 'string', maxLength: VOICE_LIMITS.text } }, required: ['request'], additionalProperties: false } }],
      });
      if (typeof started?.thread?.id !== 'string' || !started.thread.id) throw new CodexError(502, 'Codex did not return a voice thread.');
      this.threadId = started.thread.id;
      if (this.closed) {
        await this.rpc.request('thread/unsubscribe', { threadId: this.threadId }, 2000).catch(() => {});
        this.assertActive();
      }
      await this.rpc.request('thread/realtime/start', {
        threadId: this.threadId, outputModality: 'audio', transport: { type: 'webrtc', sdp: offer },
        // Do not invent a GPT Voice model ID or override account-side routing.
        // Keep Codex's delegation prompt and automatic response handoffs.
        realtimeStartInstructions: INSTRUCTIONS,
      });
      const sdp = await answer;
      this.assertActive();
      return { sessionId: this.id, sdp };
    } catch (error) {
      await this.close(); throw error;
    } finally { clearTimeout(timeout); this.resolveSdp = undefined; this.rejectSdp = undefined; }
  }

  private push(event: Omit<Extract<VoiceEvent, { type: 'request' }>, 'sequence'> | Omit<Extract<VoiceEvent, { type: 'transcript' }>, 'sequence'>) {
    this.queue.push({ ...event, sequence: ++this.sequence });
    if (this.queue.length > VOICE_LIMITS.events) this.queue.shift();
  }

  events(after: number) {
    this.assertActive();
    if (!Number.isSafeInteger(after) || after < 0 || after > this.sequence) throw new CodexError(400, 'Invalid voice event cursor.');
    if (this.queue.length && after < this.queue[0].sequence - 1) throw new CodexError(409, 'Voice events expired. Restart voice rather than repeating requests.');
    this.lastPoll = Date.now();
    return { events: this.queue.filter(e => e.sequence > after), cursor: this.sequence };
  }

  result(requestId: string, value: unknown) {
    this.assertActive();
    const result = voiceResult(value);
    const serialized = JSON.stringify(result);
    const prior = this.completed.get(requestId);
    if (prior === serialized) return { accepted: true }; // response-loss retry, never a second RPC reply
    const rpcId = this.pending.get(requestId);
    if (rpcId === undefined || prior !== undefined) throw new CodexError(409, 'This voice request is not pending.');
    this.rpc.reply(rpcId, { success: result.success, contentItems: [{ type: 'inputText', text: result.text }] });
    this.pending.delete(requestId); this.completed.set(requestId, serialized);
    return { accepted: true };
  }

  private readonly serverRequest = (msg: RpcMessage & { id: RpcId; method: string }): boolean => {
    if (this.closed || msg.params?.threadId !== this.threadId) return false;
    const p = msg.params;
    if (msg.method !== 'item/tool/call' || p.namespace != null || p.tool !== 'set_copilot' ||
        !p.arguments || Array.isArray(p.arguments) || typeof p.arguments.request !== 'string' ||
        !p.arguments.request.trim() || p.arguments.request.length > VOICE_LIMITS.text ||
        Object.keys(p.arguments).some(k => k !== 'request') || this.pending.size ||
        this.requestIds.has(msg.id) || ++this.calls > VOICE_LIMITS.requests) {
      // Returning false produces the RPC layer's deny response, never a native-tool approval.
      void this.close(); return false;
    }
    this.turnId = typeof p.turnId === 'string' ? p.turnId : this.turnId;
    this.requestIds.add(msg.id);
    const requestId = randomUUID();
    this.pending.set(requestId, msg.id);
    this.push({ type: 'request', requestId, text: p.arguments.request });
    return true;
  };

  private readonly notification = (msg: RpcMessage) => {
    const p = msg.params;
    if (this.closed || p?.threadId !== this.threadId) return;
    if (msg.method === 'thread/realtime/sdp') {
      try { this.resolveSdp?.(voiceOffer(p.sdp)); } catch { this.rejectSdp?.(new CodexError(502, 'Codex returned an invalid audio answer.')); }
    } else if (msg.method === 'thread/realtime/transcript/done' && p.role === 'user' && typeof p.text === 'string') {
      this.push({ type: 'transcript', text: p.text.slice(0, VOICE_LIMITS.text) });
    } else if (msg.method === 'turn/started' && typeof p.turn?.id === 'string') {
      this.turnId = p.turn.id;
    } else if (msg.method === 'turn/completed') {
      this.turnId = '';
    } else if (msg.method === 'item/started' && !['userMessage', 'agentMessage', 'reasoning', 'dynamicToolCall', 'plan', 'contextCompaction'].includes(p.item?.type)) {
      void this.close();
    } else if (msg.method === 'thread/realtime/error' || msg.method === 'thread/realtime/closed') {
      // Upstream text may contain account diagnostics. Do not relay it to a browser.
      this.rejectSdp?.(new CodexError(502, 'Codex voice is unavailable for this session. Check your account voice allowance, rollout and CLI version. No API fallback was used.'));
      void this.close();
    }
  };
  private readonly disconnected = () => { void this.close(); };

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    clearTimeout(this.deadline); clearInterval(this.heartbeat);
    this.rejectSdp?.(new CodexError(410, 'Voice session ended.'));
    this.removeHandler();
    this.rpc.events.off('notification', this.notification);
    this.rpc.events.off('closed', this.disconnected);
    this.closing = Promise.resolve().then(() => this.dispose());
    return this.closing;
  }
  private async dispose() {
    let healthy = !this.rpc.isClosed;
    try {
      for (const id of this.pending.values()) {
        if (!this.rpc.isClosed) this.rpc.reply(id, { success: false, contentItems: [{ type: 'inputText', text: 'Voice stopped. Do not retry this request.' }] });
      }
      if (this.threadId && !this.rpc.isClosed) {
        if (this.turnId) await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }, 2000);
        await this.rpc.request('thread/realtime/stop', { threadId: this.threadId }, 2000);
        await this.rpc.request('thread/unsubscribe', { threadId: this.threadId }, 2000);
      }
    } catch { healthy = false; }
    finally { this.pending.clear(); this.completed.clear(); this.requestIds.clear(); this.queue = []; this.release(healthy); }
  }
}
