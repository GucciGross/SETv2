/** Run against a disposable disabled/cloud instance; no login or inference. */
import assert from 'node:assert/strict';
const base = new URL(process.env.SET_SMOKE_BASE || 'http://127.0.0.1:4000');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Disposable loopback server only');
const id = '11111111-1111-4111-8111-111111111111';
for (const [method, path, body] of [
  ['POST', '/api/copilot/voice/codex/sessions', { spaceId: id, sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' }],
  ['GET', `/api/copilot/voice/codex/sessions/${id}/events?spaceId=${id}&after=0`],
  ['POST', `/api/copilot/voice/codex/sessions/${id}/result`, { spaceId: id, requestId: id, success: true, text: 'synthetic' }],
  ['DELETE', `/api/copilot/voice/codex/sessions/${id}?spaceId=${id}`],
]) {
  const response = await fetch(new URL(path, base), { method, headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5_000) });
  assert.equal(response.status, 404, `${method} ${path}: subscription voice must be disabled`);
  assert.equal((await response.json()).error, 'Codex subscription voice is unavailable on this deployment.');
}
console.log('PASS: all subscription-voice routes fail closed without a live account or inference');
