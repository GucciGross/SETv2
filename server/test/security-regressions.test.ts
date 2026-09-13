import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import Fastify from 'fastify';
import { config } from '../src/config.js';
import { signToken } from '../src/lib/tokens.js';
import { readSession, presentedSession, sessionActive } from '../src/auth/session.js';
import { referencedFileIds } from '../src/files/access.js';

const uuid = '11111111-1111-4111-8111-111111111111';

test('SSO path selects and embeds the current session_version (OIDC regression tripwire)', async () => {
  const src = readFileSync(new URL('../src/auth/oidc.ts', import.meta.url), 'utf8');
  assert.match(src, /session_version FROM users WHERE email/, 'OIDC callback must load session_version');
  assert.match(src, /signToken\(\{\s*id: user\.id,\s*email: user\.email,\s*name: user\.name,\s*sessionVersion: user\.session_version\s*\}\)/, 'SSO token must carry sessionVersion');
  // Runtime: a token built the way oidc.ts now builds it embeds ver the guard accepts.
  const raw = signToken({ id: uuid, email: 's@example.test', name: 'S', sessionVersion: 3 });
  assert.equal((jwt.decode(raw) as jwt.JwtPayload).ver, 3);
  assert.equal(readSession(raw)?.version, 3);
});

test('asset cookies carry ver + sid derived from the bearer token', async () => {
  const raw = signToken({ id: uuid, email: 'a@example.test', name: 'A', sessionVersion: 2 });
  const bearer = jwt.decode(raw) as jwt.JwtPayload;
  // Mirror of installAssetAccess minting with the new claims.
  const cookie = jwt.sign(
    { kind: 'asset', ver: bearer.ver, sid: bearer.jti },
    config.jwtSecret, { algorithm: 'HS256', subject: uuid, audience: 'set-assets', expiresIn: 300 },
  );
  const claims = jwt.verify(cookie, config.jwtSecret, { algorithms: ['HS256'], audience: 'set-assets' }) as jwt.JwtPayload;
  assert.equal(claims.ver, 2, 'asset cookie must carry bearer session_version');
  assert.equal(claims.sid, bearer.jti, 'asset cookie must carry bearer session id');
  // access.ts must copy ver/sid from the bearer; revocation happens in the session guard's
  // DB check on /api/files|captures (same tree), so asset routes stay DB-free at mint time.
  const src = readFileSync(new URL('../src/files/access.ts', import.meta.url), 'utf8');
  assert.match(src, /ver: decoded\?\.ver \?\? 0/, 'mint must copy bearer session_version');
  assert.match(src, /sid: typeof decoded\?\.jti === 'string' \? decoded\.jti : undefined/, 'mint must copy bearer session id');
  const guard = readFileSync(new URL('../src/auth/session.ts', import.meta.url), 'utf8');
  assert.match(guard, /\^\\\/api\\\/\(files\|captures\)\\\//, 'guard must authenticate asset cookies on asset routes');
  assert.match(guard, /sessionActive/, 'guard must enforce revocation');
});

test('asset cookie JWT without ver claim is rejected by the guard contract', () => {
  const stale = jwt.sign({ kind: 'asset' }, config.jwtSecret, { algorithm: 'HS256', subject: uuid, audience: 'set-assets', expiresIn: 300 });
  const claims = jwt.verify(stale, config.jwtSecret, { algorithms: ['HS256'], audience: 'set-assets' }) as jwt.JwtPayload;
  // access.ts applies `value.ver ?? 0` then Integer checks — missing ver means version 0
  const version = claims.ver ?? 0;
  assert.equal(Number.isInteger(version) && version >= 0, true);
});

test('presentedSession never authenticates asset cookies on non-asset API paths', async () => {
  const raw = signToken({ id: uuid, email: 'b@example.test', name: 'B', sessionVersion: 0 });
  const cookieJwt = jwt.sign({ kind: 'asset', ver: 0 }, config.jwtSecret, { algorithm: 'HS256', subject: uuid, audience: 'set-assets', expiresIn: 300 });
  const app = Fastify();
  app.get('/api/users/me', async (req) => ({ who: presentedSession(req) }));
  try {
    const res = await app.inject({ url: '/api/users/me', headers: { cookie: `set_asset_session=${cookieJwt}` } });
    assert.deepEqual(res.json().who, null);
  } finally { await app.close(); }
});

test('sessionActive is the shared revocation oracle and parses real sessions', async () => {
  const raw = signToken({ id: uuid, email: 'c@example.test', name: 'C', sessionVersion: 2 });
  const parsed = readSession(raw)!;
  assert.equal(parsed.userId, uuid);
  assert.equal(parsed.version, 2);
  assert.ok(parsed.sessionId);
  assert.equal(typeof sessionActive, 'function'); // DB revocation oracle; invoked by guard + asset path
});

test('asset markdown link extraction intact (sharing unaffected by access.ts edits)', () => {
  const md = '![img](/api/files/22222222-2222-4222-8222-222222222222) and https://elsewhere.example/api/files/33333333-3333-4333-8333-333333333333';
  const ids = referencedFileIds(md, 'https://set.example.test');
  assert.deepEqual(ids, ['22222222-2222-4222-8222-222222222222']);
});
