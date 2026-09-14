import { afterEach, describe, expect, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { CodexVoiceClient } from './codexVoiceClient';

const selected = { serverTranscription: true, codexRealtime: { enabled: true, selected: true } };
function client() {
  const error = vi.fn();
  return { error, value: new CodexVoiceClient('test-token', 'test-space', {
    onLive: vi.fn(), onTranscript: vi.fn(), onError: error,
    onRequest: async () => ({ success: true, text: 'ok' }),
  }) };
}
afterEach(() => vi.unstubAllGlobals());
describe('voice capability preflight', () => {
  it('does not fetch again when explicitly unselected', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await client().value.start({ serverTranscription: false })).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requests the selected microphone synchronously in the tap, before any network await', async () => {
    const microphone = vi.fn(() => Promise.reject(new DOMException('Denied', 'NotAllowedError')));
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: microphone } });
    vi.stubGlobal('RTCPeerConnection', class {});
    const c = client(); const result = c.value.start(selected);
    expect(microphone).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
    expect(await result).toBe(true); // handled error: NEVER choose another transport
    expect(c.error).toHaveBeenCalledWith(expect.stringContaining('permission was denied'));
  });
  it('fails closed on an insecure selected connection', async () => {
    vi.stubGlobal('window', { isSecureContext: false });
    const c = client(); expect(await c.value.start(selected)).toBe(true);
    expect(c.error).toHaveBeenCalledWith(expect.stringContaining('HTTPS'));
  });
  it('preserves standalone capability discovery and does not swallow failures', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('Offline')); vi.stubGlobal('fetch', fetch);
    const c = client(); expect(await c.value.start()).toBe(true);
    expect(fetch).toHaveBeenCalledOnce(); expect(c.error).toHaveBeenCalledWith('Offline');
  });
});

describe('session voice selection', () => {
  const secureEnv = () => {
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [] }) } });
    vi.stubGlobal('RTCPeerConnection', class {
      localDescription = { sdp: 'v=0\r\nm=audio 9' };
      connectionState = 'new';
      iceGatheringState = 'complete';
      addEventListener() {} removeEventListener() {}
      createDataChannel() {} addTrack() {}
      async createOffer() { return { type: 'offer', sdp: 'v=0' }; } close() {}
      async setLocalDescription() {} async setRemoteDescription() {}
    });
    vi.stubGlobal('Audio', class { setAttribute() {} play() { return Promise.resolve(); } pause() {} });
  };
  it('forwards the chosen voice on the session POST and omits it when unset', async () => {
    const fetch = vi.fn((url: any, init: any) => Promise.resolve(new Response(JSON.stringify({
      sessionId: '11111111-1111-4111-8111-111111111111', sdp: 'v=0\r\nm=audio 9',
    }), { status: 200 })));
    vi.stubGlobal('fetch', fetch);
    secureEnv();
    const withVoice = new CodexVoiceClient('t', 's', { onLive: vi.fn(), onTranscript: vi.fn(), onError: vi.fn(), onRequest: async () => ({ success: true, text: 'ok' }) }, 'cedar');
    await withVoice.start(selected);
    withVoice.stop();
    const posted = fetch.mock.calls.map(([, init]: any) => init?.body ? JSON.parse(init.body) : null).filter(Boolean);
    assert.ok(posted.some(b => b.voice === 'cedar'));
    const without = new CodexVoiceClient('t', 's', { onLive: vi.fn(), onTranscript: vi.fn(), onError: vi.fn(), onRequest: async () => ({ success: true, text: 'ok' }) });
    await without.start(selected);
    without.stop();
    const bodies = fetch.mock.calls.map(([, init]: any) => init?.body ? JSON.parse(init.body) : null).filter(Boolean);
    assert.ok(bodies.some(b => b && !('voice' in b)));
  });
  it('fails closed when the server rejects the chosen voice; no fallback', async () => {
    const fetch = vi.fn((url: any) => Promise.resolve(new Response(JSON.stringify({ error: 'That voice is not in your account catalog. Pick another voice or use the account default.' }), { status: 400 })));
    vi.stubGlobal('fetch', fetch);
    secureEnv();
    const error = vi.fn();
    const c = new CodexVoiceClient('t', 's', { onLive: vi.fn(), onTranscript: vi.fn(), onError: error, onRequest: async () => ({ success: true, text: 'ok' }) }, 'gone');
    expect(await c.start(selected)).toBe(true); // handled: never falls back to another transport
    expect(error).toHaveBeenCalledWith(expect.stringContaining('not in your account catalog'));
  });
});
