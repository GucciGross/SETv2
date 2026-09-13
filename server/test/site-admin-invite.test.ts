import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { authRoutes } from '../src/auth/routes.js';
import { spaceRoutes } from '../src/spaces/routes.js';
import { callTool } from '../src/mcp/workspace-tools.js';
import { signToken, verifyInviteToken } from '../src/lib/tokens.js';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';

/**
 * Site-admin invite-only team onboarding (private preview). The real Fastify
 * handlers, the shared inviteOne/inviteBulk helpers and the real MCP
 * import_roster tool run; only database I/O (pool.query / pool.connect) and
 * outbound mail (global fetch + config.forwardEmail.apiKey) are substituted.
 *
 * The setup email is genuinely captured through a fetch mock so the token
 * under test is the one that actually left the server — never fabricated.
 */

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN2_ID = '55555555-5555-4555-8555-555555555555'; // site admin, NOT a member of SPACE_ID
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const SPACE_ID = '33333333-3333-4333-8333-333333333333';

interface Row { [k: string]: any }

function fakeDb() {
  const users: Row[] = [
    { id: ADMIN_ID, email: 'owner@example.test', name: 'Owner', is_site_admin: true },
    { id: ADMIN2_ID, email: 'admin2@example.test', name: 'Admin Two', is_site_admin: true },
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
  const statements: string[] = [];
  return { users, memberships, spaces, resets, membersLog, statements, failResetInsert: false, failMembershipInsert: false, now: undefined as number | undefined };
}

type State = ReturnType<typeof fakeDb>;

interface Tx { open: boolean; undo: Array<() => void> }

function installDb(state: State) {
  let next = 100;
  const run = async (sql: string, values: any[], tx: Tx | null): Promise<any> => {
    const s = sql.replace(/\s+/g, ' ');
    state.statements.push(s);
    if (s === 'BEGIN') { if (tx) { tx.open = true; } return { rows: [] }; }
    if (s === 'COMMIT') { if (tx) { tx.open = false; tx.undo = []; } return { rows: [] }; }
    if (s === 'ROLLBACK') {
      if (tx) { tx.open = false; for (const undo of tx.undo.reverse()) undo(); tx.undo = []; }
      return { rows: [] };
    }
    if (s.includes('INSERT INTO auth_rate_limits')) return { rows: [{ hits: 1 }] };
    if (s.includes('SELECT id FROM users WHERE id = $1 FOR UPDATE')) return { rows: [{ id: values[0] }] };
    if (/FROM users WHERE email = \$1$/.test(s) && !s.includes('password_hash')) {
      return { rows: state.users.filter((u) => u.email === String(values[0]).toLowerCase()).map((u) => ({ id: u.id })) };
    }
    if (s.includes('SELECT is_site_admin FROM users WHERE id = $1')) {
      return { rows: state.users.filter((u) => u.id === values[0]).map((u) => ({ is_site_admin: u.is_site_admin })) };
    }
    if (s.includes('SELECT name FROM users WHERE id = $1')) {
      const found = state.users.find((u) => u.id === values[0]);
      return { rows: found ? [{ name: found.name }] : [] };
    }
    if (s.includes('INSERT INTO users') && s.includes('RETURNING id')) {
      const row = { id: `aaaaaaaa-0000-4000-8000-${String(next++).padStart(12, '0')}`, email: values[0], name: values[1], is_site_admin: false, password_hash: values[2] };
      state.users.push(row);
      if (tx?.open) tx.undo.push(() => { const i = state.users.indexOf(row); if (i >= 0) state.users.splice(i, 1); });
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
      if (tx?.open) tx.undo.push(() => { const i = state.spaces.indexOf(space); if (i >= 0) state.spaces.splice(i, 1); });
      return { rows: [space] };
    }
    if (s.includes('INSERT INTO memberships')) {
      if (state.failMembershipInsert) throw new Error('duplicate key value violates unique constraint "memberships_user_id_space_id_key"');
      const row = { user_id: values[0], space_id: values[1], role: values[2] };
      state.membersLog.push(row);
      state.memberships.push(row);
      if (tx?.open) tx.undo.push(() => {
        const l = state.membersLog.indexOf(row); if (l >= 0) state.membersLog.splice(l, 1);
        const m = state.memberships.indexOf(row); if (m >= 0) state.memberships.splice(m, 1);
      });
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
      if (state.failResetInsert) throw new Error('password_resets insert failed');
      const row = { user_id: values[0], token_hash: values[1], used: false, expires_at: (state.now ?? Date.now()) + 24 * 3600_000 };
      state.resets.push(row);
      if (tx?.open) tx.undo.push(() => { const i = state.resets.indexOf(row); if (i >= 0) state.resets.splice(i, 1); });
      return { rows: [] };
    }
    if (s.includes('SELECT user_id FROM password_resets WHERE token_hash = $1')) {
      const now = state.now ?? Date.now();
      const row = state.resets.find((x) => x.token_hash === values[0] && !x.used && x.expires_at > now);
      return { rows: row ? [{ user_id: row.user_id }] : [] };
    }
    if (s.includes('UPDATE password_resets SET used = true WHERE token_hash = $1')) {
      const now = state.now ?? Date.now();
      const row = state.resets.find((x) => x.token_hash === values[0] && !x.used && x.expires_at > now);
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
  (pool as any).query = (sql: string, values: any[] = []) => run(sql, values, null);
  (pool as any).connect = async () => {
    const tx: Tx = { open: false, undo: [] };
    return {
      query: async (text: any, values: any[] = []) => run(typeof text === 'string' ? text : text.text, values, tx),
      release: () => {},
    };
  };
  return () => {
    (pool as any).query = origQuery;
    (pool as any).connect = origConnect;
  };
}

/**
 * Mail seam: config.forwardEmail is a plain mutable object, so the test flips
 * config.forwardEmail.apiKey and stubs globalThis.fetch to capture exactly
 * what the real sendMail puts on the wire. (Mutating the ESM function export
 * itself would not work — the object field is the seam.)
 */
interface CapturedMail { to: string; subject: string; text: string; html?: string }

function installMailer(opts: { failStatus?: number; echoBody?: boolean } = {}) {
  const sent: CapturedMail[] = [];
  const errors: string[] = [];
  const origKey = config.forwardEmail.apiKey;
  const origFetch = globalThis.fetch;
  const origError = console.error;
  const origLog = console.log;
  config.forwardEmail.apiKey = 'test-api-key';
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body) as CapturedMail;
    sent.push(body);
    if (opts.failStatus) {
      const echo = opts.echoBody ? 'provider echo: ' + body.text.slice(0, 120) : '';
      console.error(`[mail] forwardemail error ${opts.failStatus}: ${echo.slice(0, 300)}`);
      return { ok: false, status: opts.failStatus, text: async () => echo };
    }
    return { ok: true, status: 200, text: async () => '' };
  }) as any;
  console.error = (...a: any[]) => { errors.push(a.join(' ')); };
  console.log = (...a: any[]) => { errors.push(a.join(' ')); };
  return {
    sent,
    errors,
    restore() {
      config.forwardEmail.apiKey = origKey;
      globalThis.fetch = origFetch;
      console.error = origError;
      console.log = origLog;
    },
  };
}

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

test('no circular import: auth/routes.ts must not import from spaces/invite.ts', () => {
  const s = readFileSync(new URL('../src/auth/routes.ts', import.meta.url), 'utf8');
  assert.ok(!s.includes("from '../spaces/invite.js'"), 'auth/routes.ts should not depend on spaces/invite.ts');
});

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
    assert.equal(state.users.length, 4, 'no accounts provisioned');
  } finally {
    await app.close(); restoreDb(); restorePreview();
  }
});

test('private preview: authority is site admin AND DB-verified workspace owner (HTTP + shared MCP route)', async () => {
  process.env.SET_PRIVATE_PREVIEW = '1';
  const state = fakeDb();
  const restoreDb = installDb(state);
  const app = buildApp();
  try {
    // A site admin who is not a workspace owner is denied — proven through the
    // shared MCP import_roster tool, whose ctx.role is caller-claimed. This is
    // the boundary HTTP cannot exercise (requireSpace rejects earlier).
    await assert.rejects(
      callTool('import_roster', { csv: 'sneak@example.test' }, { userId: ADMIN2_ID, spaceId: SPACE_ID, role: 'owner' }),
      /site admin/i,
      'claimed owner role must not stand in for a DB owner membership'
    );
    assert.equal(state.users.length, 4, 'nothing provisioned for admin non-owner');

    // A non-admin whose ctx claims owner is equally denied through MCP.
    await assert.rejects(
      callTool('import_roster', { csv: 'sneak2@example.test' }, { userId: OWNER_ID, spaceId: SPACE_ID, role: 'owner' }),
      /site admin/i
    );

    // The real admin+owner can import through the same shared MCP route.
    const mcp = await callTool('import_roster', { csv: 'viamcp@example.test' }, { userId: ADMIN_ID, spaceId: SPACE_ID, role: 'owner' });
    assert.equal((mcp.result as any).summary.provisioned, 1);
    assert.ok(state.users.some((u) => u.email === 'viamcp@example.test'));

    // HTTP single invite still gated the same way for a non-admin owner.
    const r = await app.inject({ method: 'POST', url: `/spaces/${SPACE_ID}/invite`, headers: { authorization: bearer(OWNER_ID) }, payload: { email: 'x@example.test' } });
    assert.equal(r.statusCode, 403);
  } finally {
    await app.close(); restoreDb(); restorePreview();
  }
});

test('private preview: admin invite provisions account + membership + personal space + reset row atomically', async () => {
  process.env.SET_PRIVATE_PREVIEW = '1';
  const state = fakeDb();
  const restoreDb = installDb(state);
  const mail = installMailer();
  const app = buildApp();
  try {
    const bulk = await app.inject({
      method: 'POST', url: `/spaces/${SPACE_ID}/invite-bulk`,
      headers: { authorization: bearer(ADMIN_ID) }, payload: { csv: 'email\nmate1@example.test\nmate2@example.test' },
    });
    assert.equal(bulk.statusCode, 200);
    assert.deepEqual(bulk.json().summary, { added: 0, invited: 0, already: 0, provisioned: 2 });
    assert.equal(mail.sent.length, 2, 'bulk provisioning emailed each new teammate');

    const r = await app.inject({
      method: 'POST', url: `/spaces/${SPACE_ID}/invite`,
      headers: { authorization: bearer(ADMIN_ID) }, payload: { email: 'newmate@example.test', role: 'editor' },
    });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    assert.equal(body.ok, true);
    assert.equal(body.invited, true);
    assert.equal(body.emailed, true);
    assert.equal(body.link, undefined, 'no raw link/token in the API response');

    const created = state.users.find((u) => u.email === 'newmate@example.test');
    assert.ok(created, 'account row inserted');
    assert.equal(created.is_site_admin, false, 'no implicit admin grant');
    assert.ok(await bcrypt.compare(created.password_hash, created.password_hash) || created.password_hash.startsWith('$2'), 'initial password exists only as a bcrypt hash');
    assert.ok(state.memberships.some((m) => m.user_id === created.id && m.space_id === SPACE_ID && m.role === 'editor'), 'requested membership inserted');
    assert.ok(state.spaces.some((sp) => sp.name === "newmate's Vault" && sp.kind === 'personal'), 'personal space created');
    assert.equal(state.resets.filter((x) => x.user_id === created.id).length, 1, 'one-time setup token stored (24h expiry)');
    assert.ok(state.membersLog.some((m) => m.user_id === created.id), 'membership committed');

    // Existing account already in the workspace reports 'already' (role unchanged).
    const again = await app.inject({
      method: 'POST', url: `/spaces/${SPACE_ID}/invite`,
      headers: { authorization: bearer(ADMIN_ID) }, payload: { email: 'plainowner@example.test', role: 'viewer' },
    });
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().added, false);
    assert.equal(again.json().invited, false);
    assert.equal(mail.sent.length, 3, 'no extra mail for existing members');

    // Existing account NOT yet in the workspace joins instantly with the requested role.
    const second = await app.inject({
      method: 'POST', url: `/spaces/${SPACE_ID}/invite`,
      headers: { authorization: bearer(ADMIN_ID) }, payload: { email: 'drifter@example.test', role: 'viewer' },
    });
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().added, true);
    assert.equal(mail.sent.length, 3, 'existing users join without a setup email');
  } finally {
    mail.restore();
    await app.close(); restoreDb(); restorePreview();
  }
});

test('provisioning is atomic: a failed reset-row insert rolls back user, space, membership and token', async () => {
  process.env.SET_PRIVATE_PREVIEW = '1';
  const state = fakeDb();
  state.failResetInsert = true;
  const restoreDb = installDb(state);
  const mail = installMailer();
  const app = buildApp();
  try {
    const r = await app.inject({
      method: 'POST', url: `/spaces/${SPACE_ID}/invite`,
      headers: { authorization: bearer(ADMIN_ID) }, payload: { email: 'halfdone@example.test', role: 'editor' },
    });
    assert.equal(r.statusCode, 500, 'the underlying error surfaces');
    assert.ok(state.statements.includes('ROLLBACK'), 'transaction rolled back');
    assert.equal(state.users.filter((u) => u.email === 'halfdone@example.test').length, 0, 'no half-provisioned account');
    assert.equal(state.spaces.some((sp) => sp.name === "halfdone's Vault"), false, 'no orphan personal space');
    assert.equal(state.membersLog.length, 0, 'no orphan membership');
    assert.equal(state.resets.length, 0, 'no orphan reset token');
  } finally {
    mail.restore();
    await app.close(); restoreDb(); restorePreview();
  }
});

test('setup email is captured on the wire; its token sets a real password via /auth/reset (one-time, expiring)', async () => {
  process.env.SET_PRIVATE_PREVIEW = '1';
  const state = fakeDb();
  const restoreDb = installDb(state);
  const mail = installMailer();
  const app = buildApp();
  try {
    // Provision two teammates: the second's token is deliberately expired.
    for (const email of ['setup@example.test', 'late@example.test']) {
      const invite = await app.inject({
        method: 'POST', url: `/spaces/${SPACE_ID}/invite`,
        headers: { authorization: bearer(ADMIN_ID) }, payload: { email, role: 'editor' },
      });
      assert.equal(invite.statusCode, 200);
      assert.equal(invite.json().emailed, true);
    }
    assert.equal(mail.sent.length, 2);

    const tokenFor = (email: string) => {
      const mailText = mail.sent.find((m) => m.to === email)?.text ?? '';
      const m = mailText.match(/\/reset\?token=([0-9a-f]{64})/);
      assert.ok(m, `captured email to ${email} carries the one-time set-password link`);
      return m![1];
    };
    const rawToken = tokenFor('setup@example.test');

    // The stored hash is the SHA-256 of the token that actually left the server.
    const storedHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const created = state.users.find((u) => u.email === 'setup@example.test')!;
    assert.ok(state.resets.some((x) => x.user_id === created.id && x.token_hash === storedHash), 'sha256(token) stored, never the token');

    // Password is set through the real reset route with the emailed token.
    const good = await app.inject({ method: 'POST', url: '/auth/reset', payload: { token: rawToken, password: 'new-teammate-pass1' } });
    assert.equal(good.statusCode, 200);
    const reuse = await app.inject({ method: 'POST', url: '/auth/reset', payload: { token: rawToken, password: 'another-pass123' } });
    assert.equal(reuse.statusCode, 400, 'one-time: second use refused');
    assert.ok(await bcrypt.compare('new-teammate-pass1', created.password_hash), 'password set through the real reset handler');

    // Expiry: the second teammate's link expires after 24h.
    const lateToken = tokenFor('late@example.test');
    const late = state.users.find((u) => u.email === 'late@example.test')!;
    state.now = Date.now() + 25 * 3600_000;
    const expired = await app.inject({ method: 'POST', url: '/auth/reset', payload: { token: lateToken, password: 'toolate-pass1' } });
    assert.equal(expired.statusCode, 400, 'expired setup link refused');
    state.now = undefined;
    assert.ok(!late.password_hash || !await bcrypt.compare('toolate-pass1', late.password_hash || ''), 'expired token never changed the password');

    // Teammate signs in with the password they chose.
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'setup@example.test', password: 'new-teammate-pass1' } });
    assert.equal(login.statusCode, 200);
    assert.equal(login.json().user.isSiteAdmin, false, 'safe flag on login projection');
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${login.json().token}` } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user?.isSiteAdmin, false, 'safe flag on auth/me');
  } finally {
    mail.restore();
    await app.close(); restoreDb(); restorePreview();
  }
});

test('mail provider failure never echoes the setup link into logs, API, or responses', async () => {
  process.env.SET_PRIVATE_PREVIEW = '1';
  const state = fakeDb();
  const restoreDb = installDb(state);
  const mail = installMailer({ failStatus: 422, echoBody: true });
  const app = buildApp();
  try {
    const r = await app.inject({
      method: 'POST', url: `/spaces/${SPACE_ID}/invite`,
      headers: { authorization: bearer(ADMIN_ID) }, payload: { email: 'bounce@example.test', role: 'editor' },
    });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    assert.equal(body.emailed, false, 'delivery failure reported honestly');
    assert.equal(body.link, undefined, 'no fallback link in preview mode');
    const tokenInEmail = (mail.sent[0]?.text.match(/token=([0-9a-f]{64})/) ?? [])[1];
    assert.ok(tokenInEmail, 'email body did contain the link (provider echo simulates leakage)');
    const allLogs = mail.errors.join('\n');
    assert.ok(!allLogs.includes(tokenInEmail), 'the token must never reach any log, even via provider error echoes');
  } finally {
    mail.restore();
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
      headers: { authorization: bearer(ADMIN_ID) }, payload: { email: 'outsider@example.test', role: 'viewer' },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().invited, true);
    const link: string = r.json().link;
    assert.ok(link.includes('/join?token='));
    assert.ok(verifyInviteToken(link.split('token=')[1]));
    const bulk = await app.inject({
      method: 'POST', url: `/spaces/${SPACE_ID}/invite-bulk`,
      headers: { authorization: bearer(ADMIN_ID) }, payload: { csv: 'a@example.test' },
    });
    assert.equal(bulk.statusCode, 200);
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'fresh@example.test', name: 'Fresh', password: 'longenough1' } });
    assert.equal(reg.statusCode, 200);
    assert.ok(!('isSiteAdmin' in reg.json().user), 'register projection carries no admin flag (never client-settable)');
  } finally {
    await app.close(); restoreDb(); restorePreview();
  }
});
