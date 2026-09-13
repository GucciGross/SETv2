import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import Fastify from 'fastify';
import { config } from '../src/config.js';
import { signToken } from '../src/lib/tokens.js';
import { installSessionGuard, readSession } from '../src/auth/session.js';
import { installHealth } from '../src/ops/health.js';
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'test@example.test', name: 'Test' };

test('session tokens whitelist identity, carry versions, and never include database secrets', () => {
  const raw = signToken({ ...user, sessionVersion: 7, password_hash: 'do-not-serialize' } as any);
  const p = jwt.decode(raw) as jwt.JwtPayload;
  assert.equal(p.ver, 7); assert.ok(p.jti); assert.equal(p.password_hash, undefined);
  assert.equal(readSession(raw)?.version, 7);
  assert.equal(readSession(jwt.sign({ ...user, ver: -1 }, config.jwtSecret, { expiresIn: 60 })), null);
});
test('real Fastify session guard denies revoked/old versions before handlers, but permits re-login', async () => {
  let version = 0, revoked = false, calls = 0;
  const app = Fastify();
  installSessionGuard(app, async identity => !revoked && identity.version === version);
  app.get('/api/private', async () => { calls++; return { ok: true }; });
  app.post('/api/auth/login', async () => ({ ok: true }));
  const token = signToken({ ...user, sessionVersion: 0 });
  try {
    assert.equal((await app.inject({ url: '/api/private', headers: { authorization: `Bearer ${token}` } })).statusCode, 200);
    version = 1;
    assert.equal((await app.inject({ url: '/api/private', headers: { authorization: `Bearer ${token}` } })).statusCode, 401);
    assert.equal(calls, 1);
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', headers: { authorization: `Bearer ${token}` } })).statusCode, 200);
    const fresh = signToken({ ...user, sessionVersion: 1 });
    assert.equal((await app.inject({ url: '/api/private', headers: { authorization: `Bearer ${fresh}` } })).statusCode, 200);
    revoked = true;
    assert.equal((await app.inject({ url: '/api/private', headers: { authorization: `Bearer ${fresh}` } })).statusCode, 401);
  } finally { await app.close(); }
});
test('readiness reports startup, dependency failure and draining instead of a static success', async () => {
  let dependency = true;
  const app = Fastify();
  const health = installHealth(app, async () => dependency);
  try {
    assert.equal((await app.inject('/api/ready')).statusCode, 503);
    health.started(); assert.equal((await app.inject('/api/ready')).statusCode, 200);
    dependency = false; assert.equal((await app.inject('/api/ready')).statusCode, 503);
    dependency = true; health.drain(); assert.equal((await app.inject('/api/ready')).statusCode, 503);
    assert.equal((await app.inject('/health')).statusCode, 200);
  } finally { await app.close(); }
});
