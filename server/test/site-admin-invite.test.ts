import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { authRoutes } from '../src/auth/routes.js';
import { spaceRoutes } from '../src/spaces/routes.js';
import { signToken, signInviteToken, verifyInviteToken } from '../src/lib/tokens.js';
import { pool } from '../src/db.js';

/**
 * Site-admin invite-only team onboarding (private preview). The real Fastify
 * handlers and the shared inviteOne/inviteBulk helpers run; only database I/O
 * (pool.query / pool.connect) and outbound mail are substituted:
 *
 * - With no FORWARDEMAIL_API_KEY and no SMTP_HOST, sendMail returns
 *   { sent:false } deterministically (no network I/O) and invite.ts must NOT
 *   log or return any link. The old "log the link on failure" path belongs to
 *   non-preview mode and is exercised via SET_LOG_AUTH_LINKS for /auth/forgot
 *   (existing behavior, unchanged).
 * - To prove the setup link actually works end to end without a mailbox, the
 *   provisioning seam is tested at the real /auth/reset route: a token is
 *   generated through the same shape crypto produces (the reset row is
 *   created by invite.ts), so we validate one-time semantics + password
 *   change via the stored hash. The link itself is never emitted by the API
 *   or logs (asserted below).
 */

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const SPACE_ID = '33333333-3333-4333-8333-333333333333';

interface Row { [k: string]: any }

function fakeDb() {
  const users: Row[] = [
    { id: ADMIN_ID, email: 'owner@example.test', name: 'Owner', is_site_admin: true },
    { id: OWNER_ID, email: 'plainowner@example.test', name: 'Plain Owner', is_site_admin: false },
    { id: '44444444-4444-4444-8444-444444444444', email: 'drifter@example.test', name: 'Drifter', is_site_admin: false },
  ];
  const memberships: Row[] = [
    { user_id: ADMIN_ID, space_id: SPACE_ID, role: 'owner' },
    { user_id: OWNER_ID, space_id: SPACE_ID, role: 'owner' },
  ];
  const spaces: Row[] = [{ id: SPACE_ID, name: 'Team Space' }];
  const resets: Row[] = [];
  const membersLog: Row[] = [];
  return { users, memberships, spaces, resets, membersLog };
}

type State = ReturnType<typeof fakeDb>;

function installDb(state: State) {
  let next = 100;
  const query = async (sql: string, values: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ');
    if (s.includes('INSERT INTO auth_rate_limits')) return { rows: [{ hits: 1 }] };
    if (s.startsWith('BEGIN') || s.startsWith('COMMIT') || s.startsWith('ROLLBACK')) return { rows: [] };
    if (s.includes('SELECT id FROM users WHERE id = $1 FOR UPDATE')) return { rows: [{ id: values[0] }] };
    if (/FROM users WHERE email = \$1$/.test(s) && !s.includes('password_hash')) {
      return { rows: state.users.filter((u) => u.email === String(values[0]).toLowerCase()).map((u) => ({ id: u.id })) };
    }
    if (s.includes('SELECT is_site_admin FROM users WHERE id = $1')) {
      return { rows: state.users.filter((u) => u.id === values[0]).map((u) => ({ is_site_admin: u.is_site_admin })) };
    }
    if (s.includes('INSERT INTO users') && s.includes('RETURNING id')) {
      const row = { id: `aaaaaaaa-0000-4000-8000-${String(next++).padStart(12, '0')}`, email: values[0], name: values[1], is_site_admin: false, password_hash: values[2] };
      state.users.push(row);
      return { rows: [row] };
    }
    if (s.includes('INSERT INTO users') && s.includes('ON CONFLICT (email) DO NOTHING')) {
      const row = { id: `aaaaaaaa-0000-4000-8000-${String(next++).padStart(12, '0')}`, email: values[0], name: values[1], password_hash: values[2], session_version: 0, mascot: null, onboarding: {} };
      if (state.users.some((u) => u.email === row.email)) return { rows: [] };
      state.users.push(row);
      return { rows: [row] };
    }
    if (s.includes('INSERT INTO spaces') && s.includes("'personal'")) {
      const space = { id: `bbbbbbbb-0000-4000-8000-${String(next++).padStart(12, '0')}`, name: values[0], kind: 'personal' };
      state.spaces.push(space);
      return { rows: [space] };
    }
    if (s.includes('INSERT INTO memberships')) {
      const row = { user_id: values[0], space_id: values[1], role: values[2] };
      state.membersLog.push(row);
      state.memberships.push(row);
      return { rows: [] };
    }
    if (s.includes('INSERT INTO pages')) return { rows: [] };
    if (s.includes('FROM spaces WHERE id = $1') && !s.includes('memberships')) {
      return { rows: state.spaces.filter((sp) => sp.id === values[0]).map((sp) => ({ id: sp.id, name: sp.name })) };
    }
    if (s.includes('SELECT role FROM memberships WHERE user_id = $1 AND space_id = $2')) {
      return { rows: state.memberships.filter((m) => m.user_id === values[0] && m.space_id === values[1]).map((m) => ({ role: m.role })) };
    }
    if (s.includes('INSERT INTO password_resets')) {
      state.resets.push({ user_id: values[0], token_hash: values[1], used: false });
      return { rows: [] };
    }
    if (s.includes('SELECT user_id FROM password_resets WHERE token_hash = $1')) {
      const row = state.resets.find((x) => x.token_hash === values[0] && !x.used);
      return { rows: row ? [{ user_id: row.user_id }] : [] };
    }
    if (s.includes('UPDATE password_resets SET used = true WHERE token_hash = $1')) {
      const row = state.resets.find((x) => x.token_hash === values[0] && !x.used);
      if (!row) return { rows: [] };
      row.used = true;
      return { rows: [{ id: 'r' }] };
    }
    if (s.includes('UPDATE password_resets SET used = true WHERE user_id = $1')) {
      for (const x of state.resets) if (x.user_id === values[0]) x.used = true;
      return { rows: [] };
    }
    if (s.includes('UPDATE users SET password_hash = $2 WHERE id = $1')) {
      const u = state.users.find((x) => x.id === values[0]);
      if (u) u.password_hash = values[1];
      return { rows: [] };
    }
    if (s.includes('FROM users WHERE email = $1') && s.includes('password_hash')) {
      const found = state.users.find((u) => u.email === String(values[0]).toLowerCase());
      return { rows: found ? [{ ...found, password_hash: found.password_hash ?? '', mascot: null, onboarding: {} }] : [] };
    }
    if (s.includes('SELECT mascot, onboarding, is_site_admin FROM users WHERE id = $1')) {
      const found = state.users.find((u) => u.id === values[0]);
      return { rows: found ? [{ mascot: found.mascot ?? null, onboarding: found.onboarding ?? {}, is_site_admin: !!found.is_site_admin }] : [] };
    }
    if (s.includes('INSERT INTO activities')) return { rows: [] };
    throw new Error('Unexpected query: ' + sql);
  };
  const origQuery = (pool as any).query;
  const origConnect = (pool as any).connect;
  (pool as any).query = query;
  (pool as any).connect = async () => ({
    query: async (text: any, values?: any[]) => query(typeof text === 'string' ? text : text.text, values ?? []),
    release: () => {},
  });
  return () => {
    (pool as any).query = origQuery;
    (pool as any).connect = origConnect;
  };
}

/**
 * Mail seam: config reads env once at import, so default (no FORWARDEMAIL_API_KEY,
 * no SMTP_HOST in the test process) → sendMail returns { sent:false } with no
 * network I/O. Nothing to restore: we never set transport env in tests.
 */

const bearer = (id: string) => `Bearer ${signToken({ id, email: `${id}@example.test`, name: 'T' })}`;

function buildApp() {
  const app = Fastify({ logger: false });
  app.register(authRoutes);
  app.register(spaceRoutes);
  return app;
}

const PREVIEW_ENV = process.env.SET_PRIVATE_PREVIEW;
function restorePreview() {
  if (PREVIEW_ENV === undefined) delete process.env.SET_PRIVATE_PREVIEW; else process.env.SET_PRIVATE_PREVIEW = PREVIEW_ENV;
}

test('private preview: non-admin workspace owner cannot invite (single, bulk)', async () => {
  process.env.SET_PRIVATE_PREVIEW = '1';
  const state = fakeDb();
  const restoreDb = installDb(state);
  const app = buildApp();
  try {
    for (const [url, payload] of [
      [`/spaces/${SPACE_ID}/invite`, { email: 'newmate@example.test', role: 'editor' }],
      [`/spaces/${SPACE_ID}/invite-bulk`, { csv: 'newmate@example.test' }],
    ] as const) {
      const r = await app.inject({ method: 'POST', url, headers: { authorization: bearer(OWNER_ID) }, payload });
      assert.equal(r.statusCode, 403, url);
      assert.match(r.json().error, /site admin/i);
    }
    assert.equal(state.resets.length, 0);
    assert.equal(state.users.length, 3, 'no accounts provisioned');
  } finally {
    await app.close(); restoreDb(); restorePreview();
  }
});

test('private preview: admin invite/bulk provisions account + membership + personal space, never returns or logs a link', async () => {
  process.env.SET_PRIVATE_PREVIEW = '1';
  const state = fakeDb();
  const restoreDb = installDb(state);
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...a: any[]) => { logs.push(a.join(' ')); };
  const app = buildApp();
  try {
    // Bulk covers the shared boundary the MCP import_roster tool also calls.
    const bulk = await app.inject({
      method: 'POST', url: `/spaces/${SPACE_ID}/invite-bulk`,
      headers: { authorization: bearer(ADMIN_ID) }, payload: { csv: 'email\nmate1@example.test\nmate2@example.test' },
    });
    assert.equal(bulk.statusCode, 200);
    assert.deepEqual(bulk.json().summary, { added: 0, invited: 0, already: 0, provisioned: 2 });

    const r = await app.inject({
      method: 'POST', url: `/spaces/${SPACE_ID}/invite`,
      headers: { authorization: bearer(ADMIN_ID) }, payload: { email: 'newmate@example.test', role: 'editor' },
    });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    assert.equal(body.ok, true);
    assert.equal(body.invited, true);
    assert.equal(body.link, undefined, 'no raw link/token in the API response');

    const created = state.users.find((u) => u.email === 'newmate@example.test');
    assert.ok(created, 'account row inserted');
    assert.equal(created.is_site_admin, false, 'no implicit admin grant');
    assert.ok(state.memberships.some((m) => m.user_id === created.id && m.space_id === SPACE_ID && m.role === 'editor'), 'requested membership inserted');
    assert.ok(state.spaces.some((sp) => sp.name === "newmate's Vault" && sp.kind === 'personal'), 'personal space created');
    assert.equal(state.resets.filter((x) => x.user_id === created.id).length, 1, 'one-time setup token stored (24h expiry)');
    assert.ok(!logs.join('\n').includes('token='), 'raw links never logged on delivery failure');

    // Existing account already in the workspace reports 'already' (role unchanged).
    const again = await app.inject({
      method: 'POST', url: `/spaces/${SPACE_ID}/invite`,
      headers: { authorization: bearer(ADMIN_ID) }, payload: { email: 'plainowner@example.test', role: 'viewer' },
    });
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().added, false);
    assert.equal(again.json().invited, false);

    // Existing account NOT yet in the workspace joins instantly with the requested role.
    const second = await app.inject({
      method: 'POST', url: `/spaces/${SPACE_ID}/invite`,
      headers: { authorization: bearer(ADMIN_ID) }, payload: { email: 'drifter@example.test', role: 'viewer' },
    });
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().added, true);
  } finally {
    console.log = origLog;
    await app.close(); restoreDb(); restorePreview();
  }
});

test('private preview: setup flow reaches a real password via /auth/reset; token is one-time', async () => {
  process.env.SET_PRIVATE_PREVIEW = '1';
  const state = fakeDb();
  const restoreDb = installDb(state);
  const app = buildApp();
  try {
    // Provision via the admin invite (creates user + reset row with the random bcrypt password).
    (pool as any).query; // noop to keep restore closure referenced
    const invite = await app.inject({
      method: 'POST', url: `/spaces/${SPACE_ID}/invite`,
      headers: { authorization: bearer(ADMIN_ID) }, payload: { email: 'setup@example.test', role: 'editor' },
    });
    assert.equal(invite.statusCode, 200);
    const created = state.users.find((u) => u.email === 'setup@example.test')!;
    assert.ok(created.password_hash, 'initial password exists only as a bcrypt hash');

    // The token never left the server (mail failed, nothing logged/returned), so mint the
    // equivalent credential path directly: same token shape, same SHA-256 storage, same route.
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    state.resets.length = 0;
    state.resets.push({ user_id: created.id, token_hash: hash });
    const good = await app.inject({ method: 'POST', url: '/auth/reset', payload: { token: rawToken, password: 'new-teammate-pass1' } });
    assert.equal(good.statusCode, 200);
    const reuse = await app.inject({ method: 'POST', url: '/auth/reset', payload: { token: rawToken, password: 'another-pass123' } });
    assert.equal(reuse.statusCode, 400, 'one-time: second use refused');
    assert.ok(await bcrypt.compare('new-teammate-pass1', created.password_hash), 'password set through the real reset handler');

    // Teammate signs in with the password they chose.
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'setup@example.test', password: 'new-teammate-pass1' } });
    assert.equal(login.statusCode, 200);
    assert.equal(login.json().user.isSiteAdmin, false, 'safe flag on login projection');
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${login.json().token}` } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user?.isSiteAdmin, false, 'safe flag on auth/me');
  } finally {
    await app.close(); restoreDb(); restorePreview();
  }
});

test('admin flag exposed safely; client-supplied admin flag ignored; signup stays closed in preview', async () => {
  process.env.SET_PRIVATE_PREVIEW = '1';
  const state = fakeDb();
  const restoreDb = installDb(state);
  const app = buildApp();
  try {
    const adminMe = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: bearer(ADMIN_ID) } });
    assert.equal(adminMe.statusCode, 200);
    assert.equal(adminMe.json().user.isSiteAdmin, true);
    assert.ok(!('is_site_admin' in adminMe.json().user), 'raw column not leaked');

    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'walkin@example.test', password: 'whatever123', isSiteAdmin: true } });
    assert.equal(reg.statusCode, 403, 'closed signup in preview, client admin flag ignored');

    const reg2 = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'owner@example.test', password: 'whatever123', isSiteAdmin: true } });
    assert.equal(reg2.statusCode, 403, 'existing email also refused: preview gate precedes any registration path');
  } finally {
    await app.close(); restoreDb(); restorePreview();
  }
});

test('normal selfhost unaffected: no admin gate, classic /join invite link, registration per REGISTRATION_OPEN', async () => {
  delete process.env.SET_PRIVATE_PREVIEW;
  const state = fakeDb();
  const restoreDb = installDb(state);
  const app = buildApp();
  try {
    const r = await app.inject({
      method: 'POST', url: `/spaces/${SPACE_ID}/invite`,
      headers: { authorization: bearer(OWNER_ID) }, payload: { email: 'outsider@example.test', role: 'viewer' },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().invited, true);
    const link: string = r.json().link;
    assert.ok(link.includes('/join?token='));
    assert.ok(verifyInviteToken(link.split('token=')[1]));
    const bulk = await app.inject({
      method: 'POST', url: `/spaces/${SPACE_ID}/invite-bulk`,
      headers: { authorization: bearer(OWNER_ID) }, payload: { csv: 'a@example.test' },
    });
    assert.equal(bulk.statusCode, 200);
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'fresh@example.test', name: 'Fresh', password: 'longenough1' } });
    assert.equal(reg.statusCode, 200);
    assert.ok(!('isSiteAdmin' in reg.json().user), 'register projection carries no admin flag (never client-settable)');
  } finally {
    await app.close(); restoreDb(); restorePreview();
  }
});
