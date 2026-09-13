import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, chmod, stat, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import { CodexSessions, userDirectory } from '../src/codex/sessions.js';
import { codexRoutes } from '../src/codex/routes.js';
import { signToken, signServiceToken } from '../src/lib/tokens.js';

const fixture = resolve('test/fixtures/codex-app-server.mjs');

test('model picker: discovery, validation, persistence, thread/start, isolation', async t => {
  process.env.SET_DEPLOYMENT_MODE = 'self-hosted'; process.env.SET_CODEX_OAUTH_ENABLED = '1';
  const dir = await mkdtemp(join(tmpdir(), 'set-codex-models-'));
  await chmod(fixture, 0o755);
  const pool = new CodexSessions(dir, fixture);
  t.after(async () => { await pool.close(); await rm(dir, { recursive: true, force: true }); delete process.env.SET_CODEX_OAUTH_ENABLED; delete process.env.SET_DEPLOYMENT_MODE; });
  const aliceHome = userDirectory(dir, 'alice');
  await pool.login('alice');
  await pool.select('alice', true);

  await t.test('model/list returns only sanitized catalog fields from the real app-server response', async () => {
    await writeFile(join(aliceHome, 'fixture-models'), JSON.stringify({ data: [
      { id: 'gpt-5.2', model: 'gpt-5.2', displayName: 'GPT-5.2', description: 'flagship', isDefault: true, hidden: false, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'balanced' }], accessToken: 'SECRET-TOKEN', cliAuthCredentialsStore: 'file' },
      { id: 'gpt-5.2-codex', model: 'upstream-codex-selector', displayName: 'GPT-5.2 Codex', description: 'agentic', isDefault: false, hidden: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [] },
    ], nextCursor: null, rawUpstream: 'LEAK' }), 'utf8');
    const page = await pool.models('alice');
    assert.deepEqual(page, { models: [
      { id: 'gpt-5.2', displayName: 'GPT-5.2', description: 'flagship', isDefault: true, hidden: false },
      { id: 'gpt-5.2-codex', displayName: 'GPT-5.2 Codex', description: 'agentic', isDefault: false, hidden: true },
    ], selectedModel: null });
    assert.ok(!JSON.stringify(page).includes('SECRET-TOKEN') && !JSON.stringify(page).includes('LEAK'));
  });

  await t.test('paginates with a hard page cap instead of trusting an unbounded cursor', async () => {
    await writeFile(join(aliceHome, 'fixture-models'), JSON.stringify({ data: [{ id: 'm2', model: 'm2', displayName: 'M2', description: '', isDefault: false, hidden: false, defaultReasoningEffort: 'low', supportedReasoningEfforts: [] }], nextCursor: 'page-2' }), 'utf8');
    await writeFile(join(aliceHome, 'fixture-model-cursor'), 'page-2', 'utf8');
    await writeFile(join(aliceHome, 'fixture-models-page-2'), JSON.stringify({ data: [{ id: 'm3', model: 'm3', displayName: 'M3', description: '', isDefault: false, hidden: false, defaultReasoningEffort: 'low', supportedReasoningEfforts: [] }], nextCursor: 'page-3' }), 'utf8');
    const page = await pool.models('alice');
    assert.deepEqual(page.models.map(m => m.id), ['m2', 'm3']);
  });

  await t.test('selecting an unknown or malformed model is rejected and persists nothing', async () => {
    for (const bad of ['totally-made-up', '', '  ', 'x'.repeat(200), { toString: true } as any]) {
      await assert.rejects(pool.selectModel('alice', bad), /Choose a model from the list/);
    }
    const saved = JSON.parse(await readFile(join(aliceHome, 'selection.json'), 'utf8'));
    assert.equal(saved.model, undefined);
    assert.equal((await pool.status('alice')).selectedModel, null);
  });

  await t.test('selecting a discovered catalog model persists atomically 0600 with enabled compatibility', async () => {
    await writeFile(join(aliceHome, 'fixture-models'), JSON.stringify({ data: [
      { id: 'gpt-5.2', model: 'gpt-5.2', displayName: 'GPT-5.2', description: 'flagship', isDefault: true, hidden: false, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [] },
      { id: 'gpt-5.2-codex', model: 'upstream-codex-selector', displayName: 'GPT-5.2 Codex', description: 'agentic', isDefault: false, hidden: false, defaultReasoningEffort: 'high', supportedReasoningEfforts: [] },
    ], nextCursor: null }), 'utf8');
    await pool.selectModel('alice', 'gpt-5.2');
    const st = await stat(join(aliceHome, 'selection.json'));
    assert.equal(st.mode & 0o777, 0o600);
    const saved = JSON.parse(await readFile(join(aliceHome, 'selection.json'), 'utf8'));
    assert.deepEqual(saved, { enabled: true, model: 'gpt-5.2' });
    assert.equal((await pool.status('alice')).selectedModel, 'gpt-5.2');
    assert.equal(await pool.selected('alice'), true);
  });

  await t.test('status of a legacy selection without a model exposes selectedModel null', async () => {
    await writeFile(join(aliceHome, 'selection.json'), JSON.stringify({ enabled: true }), 'utf8');
    assert.equal((await pool.status('alice')).selectedModel, null);
    await pool.selectModel('alice', 'gpt-5.2');
  });

  await t.test('thread/start carries the chosen model; a later run can switch models', async () => {
    await writeFile(join(aliceHome, 'fixture-models'), JSON.stringify({ data: [
      { id: 'gpt-5.2', model: 'gpt-5.2', displayName: 'GPT-5.2', description: '', isDefault: true, hidden: false, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [] },
      { id: 'gpt-5.2-codex', model: 'upstream-codex-selector', displayName: 'GPT-5.2 Codex', description: '', isDefault: false, hidden: false, defaultReasoningEffort: 'high', supportedReasoningEfforts: [] },
    ], nextCursor: null }), 'utf8');
    await pool.selectModel('alice', 'gpt-5.2');
    const bridge = (await pool.acquire('alice'))!;
    await bridge.complete({ messages: [{ role: 'user', content: 'Find the lesson' }], tools: [{ type: 'function', function: { name: 'search_workspace', description: 'Search SET', parameters: { type: 'object', properties: {}, required: [] } } }] }, () => {});
    const thread = JSON.parse(await readFile(join(aliceHome, 'fixture-thread.json'), 'utf8'));
    assert.equal(thread.model, 'gpt-5.2');
    await bridge.close();
    await pool.selectModel('alice', 'gpt-5.2-codex');
    const bridge2 = (await pool.acquire('alice'))!;
    await bridge2.complete({ messages: [{ role: 'user', content: 'Find the lesson' }], tools: [{ type: 'function', function: { name: 'search_workspace', description: 'Search SET', parameters: { type: 'object', properties: {}, required: [] } } }] }, () => {});
    const thread2 = JSON.parse(await readFile(join(aliceHome, 'fixture-thread.json'), 'utf8'));
    assert.equal(thread2.model, 'upstream-codex-selector');
    await bridge2.close();
  });

  await t.test('switching the model is rejected while a run is busy and changes nothing', async () => {
    const bridge = (await pool.acquire('alice'))!;
    const pending = bridge.complete({ messages: [{ role: 'user', content: 'Find the lesson' }], tools: [{ type: 'function', function: { name: 'search_workspace', description: 'Search SET', parameters: { type: 'object', properties: {}, required: [] } } }] }, () => {});
    await new Promise(r => setTimeout(r, 80));
    await assert.rejects(pool.selectModel('alice', 'gpt-5.2'), /Stop the current/);
    await assert.rejects(pool.select('alice', false), /Stop/);
    const saved = JSON.parse(await readFile(join(aliceHome, 'selection.json'), 'utf8'));
    assert.equal(saved.model, 'gpt-5.2-codex');
    await bridge.close();
    await pending;
    await pool.selectModel('alice', 'gpt-5.2');
    assert.equal(JSON.parse(await readFile(join(aliceHome, 'selection.json'), 'utf8')).model, 'gpt-5.2');
  });

  await t.test('disable preserves model and null clears without a catalog', async () => {
    await pool.select('alice', false);
    assert.equal(await pool.selectedModelId('alice'), 'gpt-5.2');
    await pool.select('alice', true);
    const catalogFile = join(aliceHome, 'fixture-models');
    const catalog = await readFile(catalogFile, 'utf8');
    await writeFile(catalogFile, '{}');
    await pool.selectModel('alice', null);
    assert.equal(await pool.selectedModelId('alice'), null);
    const bridge = (await pool.acquire('alice'))!;
    try {
      await bridge.complete({ messages: [{ role: 'user', content: 'Hello' }], tools: [{ type: 'function', function: { name: 'search_workspace', description: 'Search SET', parameters: { type: 'object', properties: {}, required: [] } } }] }, () => {});
      assert.equal(JSON.parse(await readFile(join(aliceHome, 'fixture-thread.json'), 'utf8')).model, undefined);
    } finally { await bridge.close(); await writeFile(catalogFile, catalog); }
    await pool.selectModel('alice', 'gpt-5.2');
  });

  await t.test('corrupt preferences cannot be overwritten', async () => {
    const file = join(aliceHome, 'selection.json');
    const before = await readFile(file, 'utf8');
    await writeFile(file, '{broken');
    try {
      await assert.rejects(pool.select('alice', true));
      await assert.rejects(pool.select('alice', false));
      await assert.rejects(pool.selectModel('alice', 'gpt-5.2'));
      assert.equal(await readFile(file, 'utf8'), '{broken');
    } finally { await writeFile(file, before); }
  });

  await t.test('unsafe selection files are not replaced by mutations', async () => {
    const file = join(aliceHome, 'selection.json');
    const before = await readFile(file, 'utf8');
    for (const value of ['null', JSON.stringify({ enabled: true, model: {} }), 'x'.repeat(1025), 'symlink']) {
      await rm(file);
      if (value === 'symlink') await symlink(join(aliceHome, 'missing-target'), file);
      else await writeFile(file, value);
      try {
        await assert.rejects(pool.select('alice', true));
        await assert.rejects(pool.select('alice', false));
        await assert.rejects(pool.selectModel('alice', null));
      } finally { await rm(file); await writeFile(file, before); }
    }
  });

  await t.test('per-user isolation: bob has no model and cannot write alice storage', async () => {
    await pool.login('bob');
    await pool.select('bob', true);
    assert.deepEqual((await pool.models('bob')).models, []);
    assert.equal((await pool.status('bob')).selectedModel, null);
    await assert.rejects(pool.selectModel('bob', 'gpt-5.2'), /Choose a model/);
    await writeFile(join(userDirectory(dir, 'bob'), 'fixture-models'), JSON.stringify({ data: [{ id: 'bob-model', model: 'bob-model', displayName: 'B', description: '', isDefault: true, hidden: false, defaultReasoningEffort: 'low', supportedReasoningEfforts: [] }], nextCursor: null }), 'utf8');
    await pool.selectModel('bob', 'bob-model');
    assert.equal((await pool.status('bob')).selectedModel, 'bob-model');
    assert.equal((await pool.status('alice')).selectedModel, 'gpt-5.2');
    await pool.disconnect('bob');
    assert.equal((await pool.status('bob')).selectedModel, null);
    assert.equal((await pool.status('alice')).selectedModel, 'gpt-5.2');
  });
});

test('model picker HTTP: bearer identity, safe fields, schema rejects unknown bodies', async () => {
  const calls: string[] = [];
  const app = Fastify();
  await codexRoutes(app, {
    async status(id) { calls.push(id); return { available: true, connected: true, selected: true, busy: false, account: { email: 'a@b.c', planType: 'plus' }, login: null, error: null, selectedModel: 'gpt-5.2' }; },
    async models(id) { calls.push(`models:${id}`); return { models: [{ id: 'gpt-5.2', displayName: 'GPT-5.2', description: '', isDefault: true, hidden: false }], selectedModel: 'gpt-5.2' }; },
    async selectModel(id, model) { calls.push(`selectModel:${id}:${model}`); return { selectedModel: model }; },
    async login(id) { return { available: true, connected: true, selected: false, busy: false, account: null, login: null, error: null }; },
    async cancelLogin() { throw new Error('not reached'); },
    async disconnect(id) { return { disconnected: true }; },
    async select(id, enabled) { return { selected: enabled }; },
    async close() {},
  });
  const token = signToken({ id: 'alice', name: 'Alice', email: 'alice@example.invalid' });
  const headers = { authorization: `Bearer ${token}` };
  try {
    process.env.SET_DEPLOYMENT_MODE = 'self-hosted'; process.env.SET_CODEX_OAUTH_ENABLED = '1';
    assert.equal((await app.inject({ method: 'GET', url: '/codex/models', headers })).statusCode, 200);
    assert.deepEqual(calls, ['models:alice']);
    assert.equal((await app.inject({ url: '/codex/models' })).statusCode, 401);
    assert.equal((await app.inject({ url: '/codex/models', headers: { authorization: `Bearer ${signServiceToken()}` } })).statusCode, 401);
    const ok = await app.inject({ method: 'PUT', url: '/codex/model', headers, payload: { model: 'gpt-5.2' } });
    assert.equal(ok.statusCode, 200); assert.equal(ok.json().selectedModel, 'gpt-5.2');
    const cleared = await app.inject({ method: 'PUT', url: '/codex/model', headers, payload: { model: null } });
    assert.equal(cleared.statusCode, 200); assert.equal(cleared.json().selectedModel, null);
    assert.equal((await app.inject({ method: 'PUT', url: '/codex/model', headers, payload: { model: '' } })).statusCode, 400);
    // Fastify's shared ajv config coerces scalars and strips unknown keys; the
    // catalog-membership check in sessions is the trust boundary, not the schema.
    for (const payload of [{}, { model: {} }]) {
      assert.equal((await app.inject({ method: 'PUT', url: '/codex/model', headers, payload })).statusCode, 400);
    }
    assert.equal((await app.inject({ url: '/codex/models', headers: { authorization: `Bearer ${signToken({ id: 'bob', name: 'B', email: 'b@b.c' })}` } })).statusCode, 200);
    assert.ok(calls.includes('models:bob'));
    assert.ok(!calls.some(c => c.includes('svc')));
  } finally { await app.close(); delete process.env.SET_DEPLOYMENT_MODE; delete process.env.SET_CODEX_OAUTH_ENABLED; }
});
