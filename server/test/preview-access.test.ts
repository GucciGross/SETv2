import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { previewSettings, CLOUD_NOT_READY } from '../src/auth/preview.js';
import { readFileSync } from 'node:fs';

const ON = { SET_PRIVATE_PREVIEW: '1' };

function guarded() {
  const app = Fastify();
  app.post('/auth/register', async (_req, reply) => {
    if (previewSettings(ON).enabled) return reply.code(403).send({ error: CLOUD_NOT_READY });
    return { ok: true };
  });
  app.post('/auth/login', async (req, reply) => {
    const body = req.body as any;
    if (previewSettings(ON).enabled && body.email === 'ghost@x.test') return reply.code(401).send({ error: CLOUD_NOT_READY });
    return { ok: true };
  });
  return app;
}

test('preview off by default (normal selfhost unaffected)', () => {
  assert.equal(previewSettings({}).enabled, false);
  assert.equal(previewSettings({ SET_PRIVATE_PREVIEW: '0' }).enabled, false);
  assert.equal(previewSettings({ SET_PRIVATE_PREVIEW: '' }).enabled, false);
});

test('preview on only via SET_PRIVATE_PREVIEW=1', () => {
  assert.equal(previewSettings(ON).enabled, true);
});

test('cloud notice carries selfhost link and no email address', () => {
  assert.doesNotMatch(CLOUD_NOT_READY, /@/);
  assert.match(CLOUD_NOT_READY, /github\.com\/GucciGross\/SETv2#readme/);
});

test('register is always 403 with the cloud notice while preview is on', async () => {
  const app = guarded();
  try {
    for (const payload of [{ email: 'a@b.test', password: 'longenough1' }, { email: 'bad', password: 'x' }]) {
      const res = await app.inject({ method: 'POST', url: '/auth/register', payload });
      assert.equal(res.statusCode, 403);
      assert.equal(res.json().error, CLOUD_NOT_READY);
    }
  } finally { await app.close(); }
});

test('nonexistent-user login shows the cloud notice; valid-user login still works', async () => {
  const app = guarded();
  try {
    const miss = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ghost@x.test', password: 'whatever1' } });
    assert.equal(miss.statusCode, 401);
    assert.equal(miss.json().error, CLOUD_NOT_READY);
    const hit = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'real@x.test', password: 'longenough1' } });
    assert.equal(hit.statusCode, 200);
  } finally { await app.close(); }
});

test('oidc provisioning is disabled while preview is on', () => {
  const src = readFileSync(new URL('../src/auth/oidc.ts', import.meta.url), 'utf8');
  assert.match(src, /previewEnabled\(\)/);
  assert.match(src, /if \(previewEnabled\(\)\) return false/);
});
