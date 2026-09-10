import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { CodexError } from './policy.js';

export type RpcId = string | number;
export interface RpcMessage { id?: RpcId; method?: string; params?: any; result?: any; error?: { code: number; message: string } }

/** Private NDJSON transport. Never exposed as a browser RPC proxy. */
export class CodexRpc {
  readonly events = new EventEmitter();
  readonly terminated: Promise<void>;
  onServerRequest?: (message: RpcMessage & { id: RpcId; method: string }) => boolean;
  private nextId = 0;
  private buffer = '';
  private closed = false;
  private pending = new Map<RpcId, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly child: ChildProcessWithoutNullStreams, private readonly timeoutMs = 20_000) {
    this.terminated = new Promise(resolve => { child.once('close', () => resolve()); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.read(chunk));
    // Drain without logging: upstream diagnostics may include account data.
    child.stderr.resume();
    child.on('error', () => this.stop('Codex could not start. Install the CLI in the SET server environment and check SET_CODEX_BIN.'));
    child.on('exit', () => this.stop('The Codex process stopped. Reconnect from Settings.'));
    child.stdin.on('error', () => this.stop('The Codex connection closed.'));
  }

  get isClosed() { return this.closed; }

  async initialize() {
    await this.request('initialize', {
      clientInfo: { name: 'setv2', title: 'SET', version: '2.1.0' },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: 'initialized', params: {} });
  }

  request<T = any>(method: string, params: object = {}, timeoutMs = this.timeoutMs): Promise<T> {
    if (this.closed) return Promise.reject(new CodexError(503, 'The Codex connection is closed.'));
    if (this.pending.size >= 64) return Promise.reject(new CodexError(429, 'Too many pending Codex requests.'));
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexError(504, `Codex timed out during ${method}. Check the CLI connection and try again.`));
        this.stop('Codex protocol request timed out.');
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  reply(id: RpcId, result: object) { this.send({ id, result }); }

  private send(message: RpcMessage) {
    if (this.closed) throw new CodexError(503, 'The Codex connection is closed.');
    const data = JSON.stringify(message);
    if (Buffer.byteLength(data) > 2 * 1024 * 1024) throw new CodexError(413, 'Codex request is too large. Start a shorter conversation.');
    this.child.stdin.write(data + '\n');
  }

  private read(chunk: string) {
    if (this.closed) return;
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 4 * 1024 * 1024) return this.stop('Codex exceeded the protocol buffer limit.');
    let end: number;
    while (!this.closed && (end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
      if (!line.trim()) continue;
      try {
        const msg: RpcMessage = JSON.parse(line);
        if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new Error();
        if (msg.method && msg.id !== undefined) {
          if (!this.onServerRequest?.(msg as RpcMessage & { id: RpcId; method: string }) && !this.closed) {
            this.send({ id: msg.id, error: { code: -32601, message: 'Method not permitted by SET' } });
          }
        } else if (msg.method) {
          this.events.emit('notification', msg);
        } else if (msg.id !== undefined) {
          const p = this.pending.get(msg.id);
          if (!p) continue;
          this.pending.delete(msg.id); clearTimeout(p.timer);
          if (msg.error) p.reject(new CodexError(502, 'Codex rejected the request. Check account access, usage limits, and CLI protocol compatibility.'));
          else p.resolve(msg.result);
        }
      } catch { this.stop('Invalid response from the Codex process.'); return; }
    }
  }

  stop(reason = 'Codex connection closed.') {
    if (this.closed) return;
    this.closed = true;
    this.buffer = '';
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new CodexError(503, reason)); }
    this.pending.clear();
    this.events.emit('closed', new CodexError(503, reason));
    this.onServerRequest = undefined;
    this.child.stdin.end();
    this.child.kill('SIGTERM');
    const kill = setTimeout(() => { if (this.child.exitCode === null) this.child.kill('SIGKILL'); }, 1500);
    kill.unref();
    void this.terminated.then(() => clearTimeout(kill));
  }
}
