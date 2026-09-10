import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { CodexVoiceClient } from '../../web/src/components/copilot/codexVoiceClient.js';
import { runVoiceCopilot } from '../../web/src/components/copilot/runVoiceCopilot.js';
const OFFER = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const ID = '11111111-1111-4111-8111-111111111111';
const tick = () => new Promise(r => setTimeout(r, 10));
function browser(t: any, fetcher: (url: string, init?: RequestInit) => Promise<Response>) {
  let stoppedTracks = 0; let peerClosed = 0; let permissionCalls = 0;
  let getMedia = async () => stream;
  const stream: any = { getTracks: () => [{ stop: () => { stoppedTracks++; } }] };
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: any) => { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  const audios: any[] = []; const channels: string[] = [];
  class Peer extends EventTarget {
    connectionState = 'new'; iceGatheringState = 'complete'; localDescription: any;
    onconnectionstatechange?: () => void;
    addTrack() {} createDataChannel(name: string) { channels.push(name); }
    async createOffer() { return { type: 'offer', sdp: OFFER }; }
    async setLocalDescription(d: any) { this.localDescription = d; }
    async setRemoteDescription() { this.connectionState = 'connected'; this.onconnectionstatechange?.(); }
    close() { peerClosed++; }
  }
  install('window', { isSecureContext: true });
  install('navigator', { mediaDevices: { getUserMedia: () => { permissionCalls++; return getMedia(); } } });
  install('RTCPeerConnection', Peer);
  install('Audio', class { muted = false; srcObject: any; constructor() { audios.push(this); } setAttribute() {} pause() {} async play() {} });
  const network = mock.method(globalThis, 'fetch', ((u: any, i: any) => fetcher(String(u), i)) as typeof fetch);
  const errors: string[] = []; let requests = 0; let live = 0;
  const client = new CodexVoiceClient('original-user-token', 'space', {
    onLive: () => { live++; }, onTranscript: () => {}, onError: e => errors.push(e),
    onRequest: async () => { requests++; return { success: true, text: 'Done through chat' }; },
  });
  t.after(() => { client.stop(); network.mock.restore(); for (const [k, d] of originals) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; } });
  return { client, errors, audios, channels, stream, counts: () => ({ stoppedTracks, peerClosed, permissionCalls, requests, live }), setMedia: (fn: () => Promise<any>) => { getMedia = fn; } };
}
const capabilities = () => Response.json({ codexRealtime: { enabled: true, selected: true } });

test('disabled voice preserves existing microphone without requesting permission', async t => {
  const f = browser(t, async () => Response.json({ codexRealtime: { enabled: false, selected: false } }));
  assert.equal(await f.client.start(), false); assert.equal(f.counts().permissionCalls, 0);
});
test('capability failure is not permission to silently use a paid transcription fallback', async t => {
  const f = browser(t, async () => Response.json({ error: 'Unavailable' }, { status: 503 }));
  assert.equal(await f.client.start(), true); assert.equal(f.errors.length, 1); assert.equal(f.counts().permissionCalls, 0);
});
test('cancelled late microphone permission stops tracks and never signals', async t => {
  let resolve!: (v: any) => void; let signals = 0;
  const f = browser(t, async url => { if (url.endsWith('/capabilities')) return capabilities(); signals++; return Response.json({}); });
  f.setMedia(() => new Promise(r => { resolve = r; }));
  const start = f.client.start(); await tick(); f.client.stop(); resolve(f.stream); await start;
  assert.equal(f.counts().stoppedTracks, 1); assert.equal(signals, 0);
});
test('late SDP response after cancel is deleted using the original account token', async t => {
  let finish!: (v: Response) => void; const deletes: RequestInit[] = [];
  const f = browser(t, async (url, init) => {
    if (url.endsWith('/capabilities')) return capabilities();
    if (init?.method === 'DELETE') { deletes.push(init); return Response.json({ stopped: true }); }
    return new Promise(r => { finish = r; });
  });
  const start = f.client.start(); await tick(); f.client.stop(); finish(Response.json({ sessionId: ID, sdp: OFFER })); await start;
  assert.equal(deletes.length, 1); assert.equal((deletes[0].headers as any).authorization, 'Bearer original-user-token');
  assert.equal(f.counts().stoppedTracks, 1); assert.equal(f.counts().peerClosed, 1);
});
test('live WebRTC voice delegates once and posts only the completed chat result', async t => {
  const results: any[] = [];
  const f = browser(t, async (url, init) => {
    if (url.endsWith('/capabilities')) return capabilities();
    if (url.endsWith('/sessions')) return Response.json({ sessionId: ID, sdp: OFFER });
    if (url.includes('/events?')) return Response.json({ events: [{ sequence: 1, type: 'request', requestId: 'task-a', text: 'Build a lesson' }], cursor: 1 });
    if (url.endsWith('/result')) results.push(JSON.parse(String(init?.body)));
    return Response.json({ accepted: true });
  });
  f.client.setMuted(true); assert.equal(await f.client.start(), true); await tick();
  assert.deepEqual(f.channels, ['oai-events']); assert.equal(f.audios[0].muted, true);
  assert.equal(f.counts().requests, 1); assert.equal(results.length, 1); assert.equal(results[0].text, 'Done through chat');
  f.client.setMuted(false); assert.equal(f.audios[0].muted, false); f.client.stop(); assert.equal(f.counts().stoppedTracks, 1);
});
test('failed task result delivery ends voice without replaying the action', async t => {
  const f = browser(t, async (url, init) => {
    if (url.endsWith('/capabilities')) return capabilities();
    if (url.endsWith('/sessions')) return Response.json({ sessionId: ID, sdp: OFFER });
    if (url.includes('/events?')) return Response.json({ events: [{ sequence: 1, type: 'request', requestId: 'a', text: 'Create page' }], cursor: 1 });
    return init?.method === 'DELETE' ? Response.json({}) : Response.json({ error: 'Delivery failed' }, { status: 502 });
  });
  await f.client.start(); await tick(); assert.equal(f.counts().requests, 1); assert.equal(f.errors.length, 1); assert.equal(f.client.signal.aborted, true);
});
test('chat handoff excludes historical responses and invokes the shared core helper', async () => {
  const agent: any = { isRunning: false, messages: [{ id: 'old', role: 'assistant', content: 'Previous answer' }], subscribe: () => ({ unsubscribe() {} }) };
  let calls = 0;
  const result = await runVoiceCopilot(agent, 'Build it', new AbortController().signal, async (a, text) => {
    calls++; assert.equal(a, agent); assert.equal(text, 'Build it'); agent.messages.push({ id: 'new', role: 'assistant', content: 'Created the lesson after approval.' });
  });
  assert.equal(calls, 1); assert.deepEqual(result, { success: true, text: 'Created the lesson after approval.' });
});
test('busy or cancelled chat does not dispatch new work', async () => {
  let calls = 0; const ask = async () => { calls++; };
  const busy = await runVoiceCopilot({ isRunning: true }, 'Do it', new AbortController().signal, ask);
  const abort = new AbortController(); abort.abort(); const cancelled = await runVoiceCopilot({}, 'Do it', abort.signal, ask);
  assert.equal(busy.success, false); assert.equal(cancelled.success, false); assert.equal(calls, 0);
});
test('voice cancellation aborts its active chat run and never reports fabricated success', async () => {
  let aborted = 0, unsubscribed = 0;
  const controller = new AbortController();
  const agent: any = { isRunning: false, messages: [], abortRun() { aborted++; }, subscribe: () => ({ unsubscribe() { unsubscribed++; } }) };
  const result = await runVoiceCopilot(agent, 'Do it', controller.signal, async () => { agent.isRunning = true; controller.abort(); });
  assert.equal(result.success, false); assert.equal(aborted, 1); assert.equal(unsubscribed, 1);
});
