import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { codexVoiceRoutes } from '../src/copilotkit/codex-voice.js';
import { codexSessions } from '../src/codex/service.js';

const id = '11111111-1111-4111-8111-111111111111';
test('every voice route denies cloud before touching a personal CLI', async () => {
  const previous = { ...process.env };
  const app = Fastify(); let starts = 0;
  const acquire = mock.method(codexSessions, 'openVoice', async () => { starts++; throw new Error('must not spawn'); });
  Object.assign(process.env, { SET_DEPLOYMENT_MODE: 'cloud', SET_CODEX_OAUTH_ENABLED: '1', SET_CODEX_VOICE_ENABLED: '1' });
  await codexVoiceRoutes(app);
  try {
    for (const request of [
      { method: 'POST' as const, url: '/copilot/voice/codex/sessions', payload: { spaceId: id, sdp: 'v=0\r\nm=audio 9' } },
      { method: 'GET' as const, url: `/copilot/voice/codex/sessions/${id}/events?spaceId=${id}&after=0` },
      { method: 'POST' as const, url: `/copilot/voice/codex/sessions/${id}/result`, payload: { spaceId: id, requestId: id, success: true, text: 'untrusted' } },
      { method: 'DELETE' as const, url: `/copilot/voice/codex/sessions/${id}?spaceId=${id}` },
    ]) {
      const response = await app.inject(request); assert.equal(response.statusCode, 404);
      assert.equal(response.json().error, 'Codex subscription voice is unavailable on this deployment.');
    }
    assert.equal(starts, 0);
    process.env.SET_DEPLOYMENT_MODE = 'self-hosted';
    const queryToken = await app.inject({ method: 'POST', url: '/copilot/voice/codex/sessions?token=not-accepted', payload: { spaceId: id } });
    assert.equal(queryToken.statusCode, 401); assert.equal(starts, 0);
  } finally {
    acquire.mock.restore(); await app.close();
    for (const key of ['SET_DEPLOYMENT_MODE', 'SET_CODEX_OAUTH_ENABLED', 'SET_CODEX_VOICE_ENABLED']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});
