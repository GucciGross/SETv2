import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installAssetAccess, sharedFileLinks, referencedFileIds, type AssetStore } from '../src/files/access.js';
import { signToken, verifyToken } from '../src/lib/tokens.js';
import { getUser } from '../src/lib/http.js';
const owner = '11111111-1111-1111-1111-111111111111';
const other = '22222222-2222-2222-2222-222222222222';
const fileId = '33333333-3333-3333-3333-333333333333';
const share = 'a-valid-share-token-123456';
const bearer = (id: string) => ({ authorization: `Bearer ${signToken({ id, name: 'Test', email: 'test@example.test' })}` });

test('share rewriting binds local files only and does not leak capabilities to external URLs', () => {
  const markdown = `![local](/api/files/${fileId}) ![evil](https://evil.test/api/files/${fileId}) ![protocol](//evil.test/api/files/${fileId})`;
  const rewritten = sharedFileLinks(markdown, share, 'https://set.test');
  assert.match(rewritten, new RegExp(`/api/files/${fileId}\\?share=${share}`));
  assert.ok(rewritten.includes(`https://evil.test/api/files/${fileId})`));
  assert.ok(rewritten.includes(`//evil.test/api/files/${fileId})`));
  assert.deepEqual(referencedFileIds(markdown, 'https://set.test'), [fileId]);
  assert.ok(!sharedFileLinks(`![x](/api/files/${fileId}?token=secret)`, share, 'https://set.test').includes('secret'));
});

test('actual asset routes enforce tenants, HttpOnly read-only sessions, shares, revocation and safe content headers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'set-assets-'));
  const path = join(dir, 'sample');
  await writeFile(path, 'test asset bytes');
  let member = true;
  let publicShare = true;
  let mime = 'image/png';
  let lookups = 0;
  const store: AssetStore = {
    async find(kind, key) {
      lookups++;
      if (key !== (kind === 'file' ? fileId : `${fileId}.png`)) return null;
      return { id: fileId, spaceId: 'space-a', path, name: 'sample.html', mime };
    },
    async member(userId, spaceId) { return member && userId === owner && spaceId === 'space-a'; },
    async shared(token, file) { return publicShare && token === share && file.id === fileId; },
  };
  const app = Fastify();
  installAssetAccess(app, store);
  app.get('/api/test', async () => ({ ok: true }));
  app.get('/api/ordinary-auth', async req => ({ authenticated: !!getUser(req) }));
  app.get(`/api/share/${share}`, async () => ({ page: { markdown: `![asset](/api/files/${fileId})` } }));
  try {
    const unauthorized = await app.inject({ url: `/api/files/${fileId}` });
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(lookups, 0);
    assert.equal((await app.inject({ url: `/api/files/${fileId}`, headers: bearer(other) })).statusCode, 404);
    assert.equal((await app.inject({ url: `/api/captures/${fileId}.png`, headers: bearer(other) })).statusCode, 404);
    const session = await app.inject({ url: '/api/test', headers: bearer(owner) });
    const setCookie = String(session.headers['set-cookie']);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0];
    assert.equal(verifyToken(cookie.slice(cookie.indexOf('=') + 1)), null);
    assert.equal((await app.inject({ url: '/api/ordinary-auth', headers: { cookie } })).json().authenticated, false);
    const image = await app.inject({ url: `/api/files/${fileId}`, headers: { cookie } });
    assert.equal(image.statusCode, 200);
    assert.equal(image.body, 'test asset bytes');
    assert.equal(image.headers['cache-control'], 'private, no-store');
    assert.equal((await app.inject({ url: `/api/captures/${fileId}.png`, headers: { cookie } })).statusCode, 200);
    member = false;
    assert.equal((await app.inject({ url: `/api/files/${fileId}`, headers: { cookie } })).statusCode, 404);
    assert.equal((await app.inject({ url: `/api/files/${fileId}?share=${share}` })).statusCode, 200);
    publicShare = false;
    assert.equal((await app.inject({ url: `/api/files/${fileId}?share=${share}` })).statusCode, 404);
    member = true;
    mime = 'text/html';
    const active = await app.inject({ url: `/api/files/${fileId}`, headers: { cookie } });
    assert.match(String(active.headers['content-disposition']), /^attachment;/);
    assert.match(String(active.headers['content-security-policy']), /sandbox/);
    assert.equal(active.headers['x-content-type-options'], 'nosniff');
    const sharedPage = await app.inject({ url: `/api/share/${share}` });
    assert.match(sharedPage.json().page.markdown, /\?share=/);
    const logout = await app.inject({ method: 'DELETE', url: '/api/assets/session' });
    assert.match(String(logout.headers['set-cookie']), /Max-Age=0/);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
