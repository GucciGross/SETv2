import { afterEach, describe, expect, it, vi } from 'vitest';
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
