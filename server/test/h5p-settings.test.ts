import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { H5PConfig } from '@lumieducation/h5p-server';
import { StudioSettings, studioSettings } from '../src/h5p/settings.js';
import { coreRoot, runtime, runtimeReady } from '../src/h5p/runtime.js';
import { config } from '../src/config.js';

test('registration saves do not corrupt parallel runtime initialization or lose settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'set-h5p-settings-'));
  const previous = config.dataDir;
  config.dataDir = directory;
  try {
    const file = join(directory, 'h5p', 'settings.json');
    const stores = await Promise.all(Array.from({ length: 20 }, () => studioSettings(file)));
    assert.ok(stores.every((store) => store === stores[0]));
    const settings = await new H5PConfig(stores[0]).load();
    settings.uuid = 'registered-site';
    const scope = { spaceId: randomUUID(), user: { id: randomUUID(), name: 'Test', email: 'test@example.invalid' }, role: 'owner' as const, mode: 'edit' as const, readable: [] };
    await Promise.all([
      settings.save(),
      ...Array.from({ length: 12 }, (_, i) => stores[0].save(`testKey${i}`, i)),
      ...Array.from({ length: 40 }, (_, i) => (async () => {
        for (let round = 0; round < 4; round++) {
          const base = `/api/h5p/runtime/test-${i}`;
          const rt = await runtime(scope, base);
          assert.equal(rt.editor.config.baseUrl, base, 'request-local launch URL');
        }
      })()),
    ]);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.uuid, 'registered-site');
    for (let i = 0; i < 12; i++) assert.equal(saved[`testKey${i}`], i);
    assert.equal(await (await StudioSettings.open(file)).load('uuid'), 'registered-site');
    assert.deepEqual((await readdir(join(directory, 'h5p'))).filter((f) => f.endsWith('.tmp')), []);
  } finally { config.dataDir = previous; await rm(directory, { force: true, recursive: true }); }
});

test('invalid existing settings are reported, not silently replaced', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'set-h5p-invalid-'));
  try {
    const file = join(directory, 'settings.json');
    await writeFile(file, 'broken');
    await assert.rejects(() => studioSettings(file));
    assert.equal(await readFile(file, 'utf8'), 'broken');
    await writeFile(file, '{"uuid":"repaired"}');
    assert.equal(await (await studioSettings(file)).load('uuid'), 'repaired');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('bundled H5P assets resolve independently of the startup directory', async () => {
  const cwd = process.cwd(), configured = process.env.H5P_ASSETS_DIR;
  delete process.env.H5P_ASSETS_DIR;
  try {
    const root = coreRoot(), installed = await runtimeReady();
    process.chdir(tmpdir());
    assert.equal(coreRoot(), root);
    assert.equal(await runtimeReady(), installed);
    process.env.H5P_ASSETS_DIR = '/tmp/custom-h5p-assets';
    assert.equal(coreRoot(), '/tmp/custom-h5p-assets');
  } finally {
    process.chdir(cwd);
    if (configured === undefined) delete process.env.H5P_ASSETS_DIR;
    else process.env.H5P_ASSETS_DIR = configured;
  }
});
