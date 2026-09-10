import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { codexVoiceEnabled } from '../src/codex/policy.js';
import { CodexVoice, voiceOffer, voiceResult } from '../src/codex/voice.js';
import { CodexRpc, type RpcMessage } from '../src/codex/rpc.js';

const OFFER = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const enabled = { SET_DEPLOYMENT_MODE: 'self-hosted', SET_CODEX_OAUTH_ENABLED: '1', SET_CODEX_VOICE_ENABLED: '1' };
class FakeRpc {
  events = new EventEmitter();
  isClosed = false;
  handlers = new Set<(m: any) => boolean>();
  calls: { method: string; params: any }[] = [];
  replies: { id: any; value: any }[] = [];
  beforeThread?: () => Promise<void>;
  failStart = false;
  addServerRequestHandler(fn: (m: any) => boolean) { this.handlers.add(fn); return () => { this.handlers.delete(fn); }; }
  async request(method: string, params: any) {
    this.calls.push({ method, params });
    if (method === 'thread/start') { await this.beforeThread?.(); return { thread: { id: 'voice-thread' } }; }
    if (method === 'thread/realtime/start') {
      if (this.failStart) throw new Error('fixture: unavailable');
      // Deliberately before the RPC promise continuation.
      this.notify('thread/realtime/sdp', { sdp: OFFER });
    }
    return {};
  }
  reply(id: any, value: any) { this.replies.push({ id, value }); }
  notify(method: string, params: any = {}) { this.events.emit('notification', { method, params: { threadId: 'voice-thread', ...params } }); }
  tool(id: any = 1, params: any = {}, method = 'item/tool/call') {
    return [...this.handlers].some(h => h({ id, method, params: { threadId: 'voice-thread', turnId: 'voice-turn', tool: 'set_copilot', arguments: { request: 'Create a lesson' }, ...params } }));
  }
}
function fixture(t: any, limits?: { idleMs: number; lifetimeMs: number }) {
  const old = Object.fromEntries(Object.keys(enabled).map(k => [k, process.env[k]]));
  Object.assign(process.env, enabled);
  const rpc = new FakeRpc(); let releases = 0;
  const voice = new CodexVoice(rpc as unknown as CodexRpc, '/private/work', 'space-a', () => { releases++; }, limits);
  t.after(async () => {
    await voice.close();
    for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  return { rpc, voice, releases: () => releases };
}

test('voice requires all three explicit self-hosted flags', () => {
  assert.equal(codexVoiceEnabled(enabled), true);
  for (const env of [{}, { ...enabled, SET_DEPLOYMENT_MODE: 'cloud' }, { ...enabled, SET_DEPLOYMENT_MODE: 'unknown' },
    { ...enabled, SET_CODEX_OAUTH_ENABLED: '0' }, { ...enabled, SET_CODEX_VOICE_ENABLED: '' }]) assert.equal(codexVoiceEnabled(env), false);
});
test('offers and handoff results are strictly bounded', () => {
  assert.equal(voiceOffer(OFFER), OFFER);
  for (const v of [null, {}, '', 'v=0\r\nm=video 9', OFFER + 'x'.repeat(64_000)]) assert.throws(() => voiceOffer(v));
  for (const v of [null, {}, { success: 'true', text: 'x' }, { success: true, text: '' }, { success: true, text: 'x'.repeat(12_001) }]) assert.throws(() => voiceResult(v));
  assert.deepEqual(voiceResult({ success: false, text: 'Denied' }), { success: false, text: 'Denied' });
});
test('starts official WebRTC protocol and accepts SDP before RPC response without guessing a model', async t => {
  const { rpc, voice } = fixture(t);
  assert.deepEqual(await voice.start(OFFER), { sessionId: voice.id, sdp: OFFER });
  const start = rpc.calls.find(c => c.method === 'thread/realtime/start')!.params;
  assert.deepEqual(start.transport, { type: 'webrtc', sdp: OFFER }); assert.equal(start.outputModality, 'audio');
  assert.ok(!('model' in start)); assert.ok(!('prompt' in start));
  assert.deepEqual(rpc.calls[0].params.dynamicTools.map((x: any) => x.name), ['set_copilot']);
});
test('handoffs are bound to pending IDs; identical result retries never execute or reply twice', async t => {
  const { rpc, voice } = fixture(t); await voice.start(OFFER);
  assert.equal(rpc.tool(7), true);
  const event = voice.events(0).events[0]; assert.equal(event.type, 'request');
  if (event.type !== 'request') throw new Error('Missing handoff');
  assert.throws(() => voice.result('other-id', { success: true, text: 'Made up' }));
  const denied = { success: false, text: 'The user rejected this action. Nothing was changed.' };
  voice.result(event.requestId, denied); voice.result(event.requestId, denied);
  assert.equal(rpc.replies.length, 1); assert.equal(rpc.replies[0].id, 7); assert.equal(rpc.replies[0].value.success, false);
  assert.throws(() => voice.result(event.requestId, { success: true, text: 'Changed result' }));
});
test('unrelated text threads and native tool requests are never handled as voice tasks', async t => {
  const { rpc, voice } = fixture(t); await voice.start(OFFER);
  assert.equal(rpc.tool(1, { threadId: 'text-thread' }), false); assert.equal(voice.events(0).events.length, 0);
  assert.equal(rpc.tool(2, { tool: 'shell' }), false); await voice.close();
  assert.equal(rpc.replies.length, 0); assert.equal(rpc.handlers.size, 0);
});
test('duplicate native RPC IDs and concurrent delegation fail closed', async t => {
  const { rpc, voice } = fixture(t); await voice.start(OFFER);
  assert.equal(rpc.tool(9), true); assert.equal(rpc.tool(9), false);
  await voice.close(); assert.equal(rpc.replies.length, 1); assert.equal(rpc.replies[0].value.success, false);
});
test('only owned user transcripts appear; cursors detect dropped events', async t => {
  const { rpc, voice } = fixture(t); await voice.start(OFFER);
  rpc.notify('thread/realtime/transcript/done', { role: 'user', text: 'foreign', threadId: 'other' });
  assert.equal(voice.events(0).events.length, 0);
  for (let i = 0; i < 130; i++) rpc.notify('thread/realtime/transcript/done', { role: 'user', text: `line ${i}` });
  assert.throws(() => voice.events(0)); assert.equal(voice.events(2).events.length, 128);
  assert.throws(() => voice.events(131)); assert.throws(() => voice.events(-1));
});
test('close is idempotent, interrupts pending work and releases every listener', async t => {
  const { rpc, voice, releases } = fixture(t); await voice.start(OFFER); rpc.tool();
  await Promise.all([voice.close(), voice.close()]);
  assert.equal(releases(), 1); assert.equal(rpc.handlers.size, 0); assert.equal(rpc.events.listenerCount('notification'), 0);
  assert.equal(rpc.replies[0].value.success, false);
  assert.ok(rpc.calls.some(c => c.method === 'turn/interrupt')); assert.ok(rpc.calls.some(c => c.method === 'thread/realtime/stop'));
  assert.throws(() => voice.events(0));
});
test('startup failures release voice without a provider fallback', async t => {
  const { rpc, voice, releases } = fixture(t); rpc.failStart = true;
  await assert.rejects(voice.start(OFFER)); assert.equal(releases(), 1); assert.equal(rpc.handlers.size, 0);
  assert.ok(rpc.calls.every(c => c.method.startsWith('thread/')));
});
test('cancellation during thread creation does not launch a late realtime session', async t => {
  const { rpc, voice } = fixture(t); let resume!: () => void;
  rpc.beforeThread = () => new Promise<void>(r => { resume = r; });
  const start = voice.start(OFFER); await voice.close(); resume();
  await assert.rejects(start); assert.ok(!rpc.calls.some(c => c.method === 'thread/realtime/start'));
});
test('abandoned sessions expire without an open browser tab', async t => {
  const { voice, releases } = fixture(t, { idleMs: 10, lifetimeMs: 500 }); await voice.start(OFFER);
  await new Promise(r => setTimeout(r, 45)); assert.equal(releases(), 1);
});
test('disabling the deployment gate stops existing audio sessions', async t => {
  const { voice, releases } = fixture(t, { idleMs: 20, lifetimeMs: 500 }); await voice.start(OFFER);
  process.env.SET_DEPLOYMENT_MODE = 'cloud'; assert.throws(() => voice.events(0));
  await new Promise(r => setTimeout(r, 40)); assert.equal(releases(), 1);
});
test('RPC multiplexing keeps text and voice handlers independent and denies unknown requests', () => {
  const child: any = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.exitCode = null; child.kill = () => { child.exitCode = 0; child.emit('close'); }; const writes: RpcMessage[] = [];
  child.stdin.on('data', (b: Buffer) => writes.push(JSON.parse(b.toString())));
  const rpc = new CodexRpc(child); let text = 0, voice = 0;
  rpc.onServerRequest = m => { if (m.params.threadId !== 'text') return false; text++; return true; };
  const remove = rpc.addServerRequestHandler(m => { if (m.params.threadId !== 'voice') return false; voice++; return true; });
  for (const [id, threadId] of [[1, 'text'], [2, 'voice'], [3, 'unknown']]) child.stdout.write(JSON.stringify({ id, method: 'item/tool/call', params: { threadId } }) + '\n');
  assert.equal(text, 1); assert.equal(voice, 1); assert.equal(writes[0].error?.code, -32601);
  remove(); child.stdout.write(JSON.stringify({ id: 4, method: 'item/tool/call', params: { threadId: 'voice' } }) + '\n');
  assert.equal(writes[1].error?.code, -32601); rpc.stop();
});
