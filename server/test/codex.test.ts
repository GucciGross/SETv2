import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, chmod, stat, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { CodexSessions, codexEnvironment, userDirectory } from '../src/codex/sessions.js';
import { codexOAuthEnabled, validateDeviceLogin } from '../src/codex/policy.js';
import { CodexRpc } from '../src/codex/rpc.js';

const fixture = resolve('test/fixtures/codex-app-server.mjs');
const tools = [{ type: 'function' as const, function: { name: 'search_workspace', description: 'Search SET', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } }];
const messages = [{ role: 'user' as const, content: 'Find the lesson' }];

test('deployment gate is explicit, server-owned and fail closed', () => {
  for (const mode of [undefined, '', 'cloud', 'self-hosted', 'unknown']) {
    for (const flag of [undefined, '', '0', 'true', '1']) {
      assert.equal(codexOAuthEnabled({ SET_DEPLOYMENT_MODE: mode, SET_CODEX_OAUTH_ENABLED: flag }), mode === 'self-hosted' && flag === '1');
    }
  }
});
test('child environment excludes all server/provider secrets and external Codex homes', () => {
  const env = codexEnvironment('/private/account', { PATH: '/bin', OPENAI_API_KEY: 'secret', CODEX_HOME: '/other', DATABASE_URL: 'secret', JWT_SECRET: 'secret', HOME: '/admin', HTTP_PROXY: 'secret' });
  assert.deepEqual(Object.keys(env).sort(), ['CODEX_HOME', 'HOME', 'PATH', 'XDG_CONFIG_HOME'].sort());
  assert.equal(env.CODEX_HOME, '/private/account/credentials');
  assert.equal(userDirectory('/data', '../other'), userDirectory('/data', '../other'));
  assert.match(userDirectory('/data', '../other'), /^\/data\/codex-users\/[a-f0-9]{64}$/);
  assert.notEqual(userDirectory('/data', 'alice'), userDirectory('/data', 'bob'));
});
test('device verification URLs cannot be redirected or import tokens', () => {
  const valid = { type: 'chatgptDeviceCode', loginId: 'id', userCode: 'ABCD-1234', verificationUrl: 'https://auth.openai.com/codex/device' };
  assert.deepEqual(validateDeviceLogin({ ...valid, accessToken: 'not-returned' }), { loginId: 'id', userCode: valid.userCode, verificationUrl: valid.verificationUrl });
  for (const overrides of [{ loginId: '' }, { type: 'apiKey' }, { verificationUrl: 'https://evil.invalid' }, { userCode: '<script>' }]) assert.throws(() => validateDeviceLogin({ ...valid, ...overrides }));
});
test('private sessions: managed login, selection, isolation, native tool bridge, cancellation and logout', async t => {
  process.env.SET_DEPLOYMENT_MODE = 'self-hosted'; process.env.SET_CODEX_OAUTH_ENABLED = '1';
  const dir = await mkdtemp(join(tmpdir(), 'set-codex-test-'));
  await chmod(fixture, 0o755);
  const pool = new CodexSessions(dir, fixture);
  t.after(async () => { await pool.close(); await rm(dir, { recursive: true, force: true }); delete process.env.SET_CODEX_OAUTH_ENABLED; delete process.env.SET_DEPLOYMENT_MODE; });
  const home = userDirectory(dir, 'alice');
  await t.test('not selected until explicit opt-in; authentication never shared', async () => {
    assert.equal(await pool.acquire('alice'), null);
    assert.equal((await pool.status('alice')).connected, false);
    const result = await pool.login('alice');
    assert.equal(result.connected, true); assert.equal(result.login, null); assert.equal(result.selected, false);
    assert.ok(!JSON.stringify(result).includes('NEVER-RETURN'));
    assert.equal((await pool.status('bob')).connected, false);
    await pool.select('alice', true);
    assert.equal(await pool.selected('alice'), true); assert.equal(await pool.selected('bob'), false);
    assert.equal((await stat(home)).mode & 0o777, 0o700);
    assert.equal((await stat(join(home, 'selection.json'))).mode & 0o777, 0o600);
  });
  await t.test('a dynamic tool waits for SET and binds the rewritten approval call ID', async () => {
    const bridge = (await pool.acquire('alice'))!;
    await assert.rejects(pool.acquire('alice'), /already has/);
    await assert.rejects(pool.select('alice', false), /Stop/);
    const deltas: string[] = [];
    const result = await bridge.complete({ messages, tools }, d => deltas.push(d));
    assert.equal(result.tool_calls.length, 1); assert.equal(deltas.join(''), 'Checking…');
    const call = result.tool_calls[0]; call.id = 'rewritten-by-set';
    const done = await bridge.complete({ messages: [...messages, { role: 'tool', tool_call_id: call.id, content: '{"ok":true}' }], tools }, d => deltas.push(d));
    assert.equal(done.content, 'Verified tool result.');
    const thread = JSON.parse(await readFile(join(home, 'fixture-thread.json'), 'utf8'));
    const turn = JSON.parse(await readFile(join(home, 'fixture-turn.json'), 'utf8'));
    assert.equal(thread.ephemeral, true); assert.equal(thread.approvalPolicy, 'never');
    assert.deepEqual(turn.sandboxPolicy.access.readableRoots, [thread.cwd]);
    assert.equal(turn.sandboxPolicy.access.includePlatformDefaults, false);
    assert.notEqual(thread.cwd, home);
    await bridge.close(); assert.equal((await pool.status('alice')).busy, false);
  });
  await t.test('unapproved native tools stop the bridge rather than execute through SET', async () => {
    const bridge = (await pool.acquire('alice'))!;
    await assert.rejects(bridge.complete({ messages: [{ role: 'user', content: 'NATIVE_ESCAPE' }], tools }, () => {}), /native Codex tool/);
    assert.equal(bridge.signal.aborted, true); await bridge.close();
  });
  await t.test('disconnect cancels a tool pause, removes credentials and deselects', async () => {
    const bridge = (await pool.acquire('alice'))!;
    await bridge.complete({ messages, tools }, () => {});
    await pool.disconnect('alice');
    assert.equal(bridge.signal.aborted, true); assert.equal(await pool.selected('alice'), false);
    await assert.rejects(stat(join(home, 'credentials')), { code: 'ENOENT' });
    assert.equal((await pool.status('alice')).connected, false);
  });
  await t.test('pending login can be cancelled, duplicate prompts are not created', async () => {
    await writeFile(join(userDirectory(dir, 'bob'), 'pause-login'), 'fixture');
    const pending = await pool.login('bob'); assert.equal(pending.login?.userCode, 'TEST-1234');
    assert.deepEqual((await pool.login('bob')).login, pending.login);
    assert.equal((await pool.cancelLogin('bob')).login, null);
    await assert.rejects(pool.login('bob'), /30 seconds/);
  });
  await t.test('closed process replacement shares one promise and waits for termination', async () => {
    const s = await (pool as any).get('alice'); s.rpc.stop();
    const [a, b] = await Promise.all([(pool as any).get('alice'), (pool as any).get('alice')]);
    assert.equal(a, b); assert.notEqual(a, s);
    await assert.rejects(stat(s.workDir), { code: 'ENOENT' });
  });
  await t.test('idle reaping does not reset its own idle clock', async () => {
    const s = await (pool as any).get('alice'); s.touched = Date.now() - 301_000;
    await (pool as any).sweep();
    assert.equal(s.rpc.isClosed, true); await assert.rejects(stat(s.workDir), { code: 'ENOENT' });
  });
  await t.test('cloud rejects existing credentials without starting or consuming them', async () => {
    process.env.SET_DEPLOYMENT_MODE = 'cloud';
    assert.equal(await pool.acquire('bob'), null);
    await assert.rejects(pool.login('bob'), /unavailable/);
    await assert.rejects(pool.disconnect('bob'), /unavailable/);
    process.env.SET_DEPLOYMENT_MODE = 'self-hosted';
  });
});
test('protocol timeout kills process, clears requests, and never forwards raw upstream errors', async () => {
  const silent = spawn(process.execPath, ['-e', 'process.stdin.resume()'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const rpc = new CodexRpc(silent, 25);
  await assert.rejects(rpc.initialize(), /timed out/); await rpc.terminated; assert.equal(rpc.isClosed, true);
  const child = spawn(process.execPath, ['-e', `process.stdin.on('data', d => { const m = JSON.parse(d); process.stdout.write(JSON.stringify({id:m.id,error:{code:1,message:'SECRET-TOKEN'}})+'\\n'); });`], { stdio: ['pipe', 'pipe', 'pipe'] });
  const errors = new CodexRpc(child);
  await assert.rejects(errors.initialize(), e => !String(e).includes('SECRET-TOKEN'));
  errors.stop(); await errors.terminated;
});
test('turning off a saved selection does not require an installed CLI', async () => {
  process.env.SET_DEPLOYMENT_MODE = 'self-hosted'; process.env.SET_CODEX_OAUTH_ENABLED = '1';
  const dir = await mkdtemp(join(tmpdir(), 'set-codex-missing-'));
  const pool = new CodexSessions(dir, '/no/such/codex');
  try {
    await assert.rejects(pool.status('user'), /could not start/);
    await pool.select('user', false); assert.equal(await pool.selected('user'), false);
    await pool.disconnect('user');
  } finally { await pool.close(); await rm(dir, { recursive: true, force: true }); delete process.env.SET_CODEX_OAUTH_ENABLED; delete process.env.SET_DEPLOYMENT_MODE; }
});
