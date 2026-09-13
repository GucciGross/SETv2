import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import Fastify from 'fastify';
import { config } from '../src/config.js';
import { signToken } from '../src/lib/tokens.js';
import { installSessionGuard, readSession, presentedSession } from '../src/auth/session.js';
import { installAssetAccess } from '../src/files/access.js';

const id = '11111111-1111-4111-8111-111111111111';
const user = { id, email: 'test@example.test', name: 'Test' };

test('OIDC loads and signs the current session version', () => {
  const src = readFileSync(new URL('../src/auth/oidc.ts', import.meta.url), 'utf8');
  assert.match(src, /session_version FROM users WHERE email/);
  assert.match(src, /sessionVersion: user.session_version/);
  assert.equal(readSession(signToken({ ...user, sessionVersion: 3 }))?.version, 3);
});

for (const legacy of [false, true]) test(`asset minting preserves bearer revocation identity (legacy=${legacy})`, async () => {
  const raw = legacy ? jwt.sign(user, config.jwtSecret, { expiresIn: 300 }) : signToken({ ...user, sessionVersion: 2 });
  const identity = readSession(raw)!;
  let revoked = false;
  const app = Fastify();
  installSessionGuard(app, async session => !revoked && session.version === identity.version && session.sessionId === identity.sessionId);
  installAssetAccess(app, {
    async find() { return null; },
    async member() { return true; },
    async shared() { return false; },
  });
  app.get('/api/test', async req => ({ session: presentedSession(req) }));
  app.get(`/api/sessions/${id}/messages`, async () => ({ ok: true }));
  try {
    const minted = await app.inject({ url: '/api/test', headers: { authorization: `Bearer ${raw}` } });
    assert.equal(minted.statusCode, 200);
    const cookie = String(minted.headers['set-cookie']).split(';')[0];
    const assetIdentity = readSession(cookie.slice(cookie.indexOf('=') + 1), true)!;
    assert.equal(assetIdentity.version, identity.version);
    assert.equal(assetIdentity.sessionId, identity.sessionId);
    assert.equal((await app.inject({ url: '/api/test', headers: { cookie } })).json().session, null);
    // 404 means authentication passed and reached the empty asset store.
    assert.equal((await app.inject({ url: `/api/files/${id}`, headers: { cookie } })).statusCode, 404);
    revoked = true;
    assert.equal((await app.inject({ url: `/api/files/${id}`, headers: { cookie } })).statusCode, 401);
    assert.equal((await app.inject({ url: `/api/captures/${id}.png`, headers: { cookie } })).statusCode, 401);
    assert.equal((await app.inject({ url: `/api/sessions/${id}/messages`, headers: { authorization: `Bearer ${raw}` } })).statusCode, 401);
  } finally { await app.close(); }
});

test('revoked bearer does not block public probes or logout', async () => {
  const app = Fastify();
  installSessionGuard(app, async () => false);
  app.get('/api/ready', async () => ({ ok: true }));
  app.post('/api/auth/logout', async () => ({ ok: true }));
  const headers = { authorization: `Bearer ${signToken(user)}` };
  try {
    assert.equal((await app.inject({ url: '/api/ready', headers })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/logout', headers })).statusCode, 200);
  } finally { await app.close(); }
});
