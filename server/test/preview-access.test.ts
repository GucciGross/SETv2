import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import bcrypt from 'bcryptjs';
import { previewSettings, CLOUD_NOT_READY } from '../src/auth/preview.js';
import { authRoutes } from '../src/auth/routes.js';
import { oidcEnabled } from '../src/auth/oidc.js';
import { pool } from '../src/db.js';

 test('private preview defaults off and only explicit 1 enables it', () => {
  for (const value of [undefined, '', '0', 'true']) assert.equal(previewSettings({ SET_PRIVATE_PREVIEW: value }).enabled, false);
  assert.equal(previewSettings({ SET_PRIVATE_PREVIEW: '1' }).enabled, true);
  assert.match(CLOUD_NOT_READY, /github\.com\/GucciGross\/SETv2#readme/);
  assert.doesNotMatch(CLOUD_NOT_READY, /@/);
});

test('real auth routes block signup, conceal failed-login identity, and allow valid tester login', async () => {
  const oldEnv = process.env.SET_PRIVATE_PREVIEW;
  const oldQuery = pool.query;
  const password = 'test-only-password';
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'tester@example.test', name: 'Test', password_hash: await bcrypt.hash(password, 4), session_version: 0 };
  // Only database I/O is substituted; exercise the actual production handlers.
  pool.query = (async (sql: string, values: any[]) => {
    if (sql.includes('INSERT INTO auth_rate_limits')) return { rows: [{ hits: 1 }] };
    if (sql.includes('FROM users WHERE email')) return { rows: values[0] === user.email ? [user] : [] };
    throw new Error('Unexpected query: ' + sql);
  }) as any;
  process.env.SET_PRIVATE_PREVIEW = '1';
  const app = Fastify();
  await app.register(authRoutes);
  try {
    assert.equal(oidcEnabled(), false);
    for (const payload of [{}, { email: 'someone@example.test', password }]) {
      const r = await app.inject({ method: 'POST', url: '/auth/register', payload });
      assert.equal(r.statusCode, 403);
      assert.equal(r.json().error, CLOUD_NOT_READY);
    }
    for (const email of ['absent@example.test', user.email]) {
      const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'wrong-password' } });
      assert.equal(r.statusCode, 401);
      assert.equal(r.json().error, CLOUD_NOT_READY);
    }
    const ok = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: user.email, password } });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().user.email, user.email);
    assert.ok(ok.json().token);
    process.env.SET_PRIVATE_PREVIEW = '0';
    const normal = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: user.email, password: 'wrong-password' } });
    assert.equal(normal.json().error, 'Invalid email or password');
  } finally {
    await app.close(); pool.query = oldQuery;
    if (oldEnv === undefined) delete process.env.SET_PRIVATE_PREVIEW; else process.env.SET_PRIVATE_PREVIEW = oldEnv;
  }
});
