import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IEditorModel } from '@lumieducation/h5p-server';
import { readGrant, signGrant } from '../src/h5p/domain.js';
import { runtime } from '../src/h5p/runtime.js';
import { editorDocument } from '../src/h5p/render.js';
import { config } from '../src/config.js';
const user = { id: randomUUID(), name: 'Test', email: 'test@example.invalid' }, space = randomUUID();
const payload = { sub: user.id, space, activity: randomUUID(), epoch: 0, parentOrigin: 'https://set.example' };

test('embedded editor shell loads only bootstrap scripts while its native iframe keeps full assets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'set-h5p-render-')), old = config.dataDir;
  config.dataDir = dir;
  try {
    const base = '/api/h5p/runtime/test-scope';
    const rt = await runtime({ spaceId: space, user, role: 'editor', mode: 'edit', readable: [] }, base);
    rt.editor.setRenderer((model) => model);
    const model = await rt.editor.render('', 'en', rt.user) as IEditorModel;
    const grant = readGrant(signGrant({ ...payload, content: null, revision: 0, mode: 'edit' }, 'test-secret').token, 'test-secret');
    const html = editorDocument(model, grant, base);
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(scripts.some((src) => src.split('?')[0].endsWith('/core/js/jquery.js')));
    assert.ok(scripts.some((src) => src.split('?')[0].endsWith('/editor/scripts/h5peditor-editor.js')));
    assert.ok(scripts.some((src) => src.split('?')[0].endsWith('/editor/language/en.js')));
    assert.ok(!scripts.some((src) => src.split('?')[0].endsWith('/editor/scripts/h5peditor.js')));
    assert.ok(!scripts.some((src) => src.split('?')[0].endsWith('/editor/scripts/h5peditor-form.js')));
    assert.ok(model.integration.editor?.assets.js.some((src) => src.split('?')[0].endsWith('/editor/scripts/h5peditor.js')));
    assert.ok(model.integration.editor?.assets.js.some((src) => src.split('?')[0].endsWith('/editor/scripts/h5peditor-form.js')));
    assert.equal(model.integration.editor?.ajaxPath.startsWith(base), true);
  } finally { config.dataDir = old; await rm(dir, { recursive: true, force: true }); }
});
