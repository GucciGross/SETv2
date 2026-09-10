import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { copilotVoiceRoutes } from '../src/copilotkit/voice.js';
import { signToken } from '../src/lib/tokens.js';
import { config } from '../src/config.js';

function form(parts: { type: string; bytes: string | Buffer }[]) {
  const boundary = 'set-test-boundary';
  const payload = Buffer.concat(parts.flatMap(p => [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="speech.webm"\r\nContent-Type: ${p.type}\r\n\r\n`), Buffer.from(p.bytes), Buffer.from('\r\n')]).concat([Buffer.from(`--${boundary}--\r\n`)]));
  return { payload, contentType: `multipart/form-data; boundary=${boundary}` };
}

test('Copilot voice: authenticated, configured, bounded, one-part and redacted', async () => {
  const app = Fastify({ bodyLimit: 12 * 1024 * 1024 });
  await app.register(multipart); await copilotVoiceRoutes(app);
  const token = signToken({ id: crypto.randomUUID(), name: 'Author', email: 'author@example.invalid' });
  const previous = { ...config.transcribe };
  let calls = 0, reject = false;
  const network = mock.method(globalThis, 'fetch', (async (_url: any, init: any) => {
    calls++; assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.body.get('file').name, 'speech.webm');
    return reject ? new Response('SECRET-PROVIDER-DETAILS', { status: 401 }) : Response.json({ text: 'Transcribed sample' });
  }) as typeof fetch);
  const send = (parts: { type: string; bytes: string | Buffer }[], auth = token) => {
    const body = form(parts);
    return app.inject({ method: 'POST', url: '/copilot/voice/transcribe', headers: { authorization: `Bearer ${auth}`, 'content-type': body.contentType }, payload: body.payload });
  };
  try {
    assert.equal((await send([{ type: 'audio/webm', bytes: 'test' }], '')).statusCode, 401);
    config.transcribe.baseUrl = undefined;
    assert.equal((await send([{ type: 'audio/webm', bytes: 'test' }])).statusCode, 503);
    config.transcribe.baseUrl = 'https://fixture.invalid/v1';
    const cap = await app.inject({ url: '/copilot/voice/capabilities', headers: { authorization: `Bearer ${token}` } });
    assert.equal(cap.json().serverTranscription, true);
    assert.equal((await send([{ type: 'text/plain', bytes: 'test' }])).statusCode, 400);
    assert.equal((await send([{ type: 'audio/webm', bytes: '' }])).statusCode, 400);
    assert.equal((await send([{ type: 'audio/webm', bytes: 'one' }, { type: 'audio/webm', bytes: 'two' }])).statusCode, 400);
    assert.equal((await send([{ type: 'audio/webm', bytes: Buffer.alloc(8 * 1024 * 1024 + 1) }])).statusCode, 413);
    assert.equal(calls, 0);
    const result = await send([{ type: 'audio/webm', bytes: 'test' }]);
    assert.equal(result.statusCode, 200); assert.equal(result.json().text, 'Transcribed sample');
    assert.equal(result.headers['cache-control'], 'no-store');
    reject = true;
    const failure = await send([{ type: 'audio/webm', bytes: 'test' }]);
    assert.equal(failure.statusCode, 502); assert.ok(!failure.body.includes('SECRET-PROVIDER'));
  } finally { Object.assign(config.transcribe, previous); network.mock.restore(); await app.close(); }
});
