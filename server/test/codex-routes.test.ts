import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { codexRoutes } from '../src/codex/routes.js';
import { signToken, signServiceToken } from '../src/lib/tokens.js';

test('Codex HTTP: cloud blocks every action; bearer identity owns all self-hosted calls', async () => {
  const calls: string[] = [];
  const app = Fastify();
  await codexRoutes(app, {
    async status(id) { calls.push(id); return { available: true, connected: false, selected: false, busy: false, account: null, login: null, error: null }; },
    async login(id) { throw new Error('SECRET-FROM-PROVIDER'); },
    async cancelLogin(id) { throw new Error('not reached'); },
    async disconnect(id) { calls.push(id); return { disconnected: true }; },
    async select(id, enabled) { calls.push(id); return { selected: enabled }; },
    async close() {},
  });
  const token = signToken({ id: 'alice', name: 'Alice', email: 'alice@example.invalid' });
  const headers = { authorization: `Bearer ${token}` };
  try {
    process.env.SET_DEPLOYMENT_MODE = 'cloud'; process.env.SET_CODEX_OAUTH_ENABLED = '1';
    assert.equal((await app.inject('/codex/capabilities')).statusCode, 401);
    assert.equal((await app.inject(`/codex/account?token=${token}`)).statusCode, 401);
    assert.equal((await app.inject({ url: '/codex/account', headers: { authorization: `Bearer ${signServiceToken()}` } })).statusCode, 401);
    const cap = await app.inject({ url: '/codex/capabilities', headers });
    assert.equal(cap.json().available, false); assert.equal(cap.json().deploymentMode, 'cloud'); assert.equal(cap.headers['cache-control'], 'no-store');
    for (const [method, url, payload] of [['GET', '/account', undefined], ['POST', '/login', {}], ['POST', '/login/cancel', {}], ['POST', '/logout', {}], ['PUT', '/selection', { enabled: true }]] as const) {
      assert.equal((await app.inject({ method, url: '/codex' + url, headers, payload })).statusCode, 404);
    }
    assert.equal(calls.length, 0);
    process.env.SET_DEPLOYMENT_MODE = 'self-hosted'; process.env.SET_CODEX_OAUTH_ENABLED = '0';
    const disabled = await app.inject({ url: '/codex/capabilities', headers });
    assert.equal(disabled.json().deploymentMode, 'self-hosted'); assert.equal(disabled.json().available, false);
    assert.equal((await app.inject({ method: 'POST', url: '/codex/login', headers, payload: {} })).statusCode, 404);
    assert.equal(calls.length, 0);
    process.env.SET_CODEX_OAUTH_ENABLED = '1';
    assert.equal((await app.inject({ url: '/codex/account?userId=bob', headers })).statusCode, 200);
    assert.deepEqual(calls, ['alice']);
    assert.equal((await app.inject({ method: 'PUT', url: '/codex/selection', headers, payload: {} })).statusCode, 400);
    const bad = await app.inject({ method: 'POST', url: '/codex/login', headers, payload: {} });
    assert.equal(bad.statusCode, 503); assert.ok(!bad.body.includes('SECRET-FROM-PROVIDER'));
    assert.equal((await app.inject({ method: 'POST', url: '/codex/logout', headers, payload: {} })).statusCode, 200);
  } finally { await app.close(); delete process.env.SET_DEPLOYMENT_MODE; delete process.env.SET_CODEX_OAUTH_ENABLED; }
});
