import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as H5P from '@lumieducation/h5p-server';
import { byteRange, finishedSchema, prepareImport, readGrant, safeJson, safeRelativePath, signGrant } from '../src/h5p/domain.js';
import { deckParameters } from '../src/h5p/from-deck.js';
import { permissions, runtime, forkContent, exportContent } from '../src/h5p/runtime.js';
import { config } from '../src/config.js';
const user = { id: randomUUID(), name: 'Test author', email: 'test@example.invalid' }, space = randomUUID();
const payload = { sub: user.id, space, activity: randomUUID(), content: '1000000000001', revision: 1, epoch: 0, mode: 'play' as const, parentOrigin: 'https://set.example' };
function pkg(extra?: (zip: AdmZip) => void) {
  const zip = new AdmZip();
  zip.addFile('h5p.json', Buffer.from(JSON.stringify({ title: 'Safe activity', mainLibrary: 'H5P.Test', preloadedDependencies: [{ machineName: 'H5P.Test', majorVersion: 1, minorVersion: 0 }] })));
  zip.addFile('content/content.json', Buffer.from('{"text":"Hello"}'));
  zip.addFile('H5P.Test-1.0/library.json', Buffer.from('{}'));
  zip.addFile('H5P.Test-1.0/test.js', Buffer.from('alert("never install user code")'));
  extra?.(zip); return zip.toBuffer();
}
test('launch grants have a separate audience, expire, and cannot become SET sessions', () => {
  const grant = signGrant(payload, 'test-secret');
  assert.equal(readGrant(grant.token, 'test-secret').sub, user.id);
  assert.equal((jwt.decode(grant.token) as any).id, undefined);
  assert.throws(() => readGrant(grant.token, 'wrong-secret'));
  for (const options of [{ audience: 'set', issuer: 'set' }, { audience: 'set:h5p', issuer: 'set', expiresIn: -1 }]) assert.throws(() => readGrant(jwt.sign({ ...payload, nonce: randomUUID() }, 'test-secret', options), 'test-secret'));
  assert.throws(() => readGrant('x'.repeat(3000), 'test-secret'));
});
test('embedded JSON cannot terminate its script element', () => {
  const text = '</script><script>alert(1)</script>\u2028&';
  assert.ok(!safeJson(text).includes('<')); assert.equal(JSON.parse(safeJson(text)), text);
});
test('media seeking supports suffix/open-ended ranges and rejects invalid ranges', () => {
  assert.equal(byteRange(undefined, 100), undefined);
  assert.deepEqual(byteRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(byteRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange('bytes=0-999', 100), { start: 0, end: 99 });
  for (const value of ['bytes=100-', 'bytes=-0', 'bytes=4-2', 'bytes=0-1,4-5', 'bytes=-99999999999999999999999', 'bytes=-', 'bad']) assert.throws(() => byteRange(value, 100), value);
});
test('asset paths reject traversal, Windows paths and NULs', () => {
  for (const path of ['../x', '/x', 'a/../x', 'a/./x', 'C:/x', 'a\\x', 'a\0x']) assert.equal(safeRelativePath(path), false, path);
  assert.equal(safeRelativePath('images/a.png'), true);
});
test('package imports strip library code but retain content and real version metadata', () => {
  const prepared = prepareImport(pkg()); const clean = new AdmZip(prepared.data);
  assert.deepEqual(clean.getEntries().map((e) => e.entryName).sort(), ['content/content.json', 'h5p.json']);
  assert.equal(prepared.dependencies[0].minorVersion, 0);
  assert.equal(clean.readAsText('content/content.json'), '{"text":"Hello"}');
});
test('package validation rejects unreadable archives, active content and malformed JSON', () => {
  assert.throws(() => prepareImport(Buffer.from('not a zip')));
  for (const extension of ['svg', 'html', 'js', 'php']) assert.throws(() => prepareImport(pkg((zip) => zip.addFile(`content/unsafe.${extension}`, Buffer.from('bad')))));
  assert.throws(() => prepareImport(pkg((zip) => zip.deleteFile('h5p.json'))));
  assert.throws(() => prepareImport(pkg((zip) => zip.addFile('content/content.json', Buffer.from('invalid json')))));
});
test('practice result validation rejects impossible scores and reversed timestamps', () => {
  const value = { contentId: '123', score: '1', maxScore: '2', opened: '100', finished: '110' };
  assert.equal(finishedSchema.parse(value).score, 1);
  for (const change of [{ score: 3 }, { finished: 99 }, { score: Infinity }]) assert.equal(finishedSchema.safeParse({ ...value, ...change }).success, false);
});
test('permissions separate readers, writers, learners and library installers', async () => {
  const native = { ...user, type: 'local' as const };
  const viewer = permissions({ spaceId: space, user, role: 'viewer', mode: 'play', readable: ['123'] });
  assert.equal(await viewer.checkForContent(native, H5P.ContentPermission.View, '123'), true);
  assert.equal(await viewer.checkForContent(native, H5P.ContentPermission.View, '456'), false);
  assert.equal(await viewer.checkForContent(native, H5P.ContentPermission.Edit, '123'), false);
  assert.equal(await viewer.checkForUserData(native, H5P.UserDataPermission.ViewState, '123', randomUUID()), false);
  const editor = permissions({ spaceId: space, user, role: 'editor', mode: 'edit', readable: ['123'], writable: ['456'] });
  assert.equal(await editor.checkForContent(native, H5P.ContentPermission.Edit, '123'), false);
  assert.equal(await editor.checkForContent(native, H5P.ContentPermission.Edit, '456'), true);
  for (const role of ['owner', 'editor'] as const) assert.equal(await permissions({ spaceId: space, user, role, mode: 'edit', readable: [] }).checkForGeneralAction(native, H5P.GeneralPermission.UpdateAndInstallLibraries), false);
  assert.equal(await permissions({ spaceId: space, user, role: 'owner', mode: 'edit', readable: [], installFromHub: true }).checkForGeneralAction(native, H5P.GeneralPermission.UpdateAndInstallLibraries), true);
});
test('deck copies require real installed versions and preserve manual grading', () => {
  const libs = [{ machineName: 'H5P.Dialogcards', majorVersion: 1, minorVersion: 9 }, { machineName: 'H5P.QuestionSet', majorVersion: 1, minorVersion: 20 }, { machineName: 'H5P.MultiChoice', majorVersion: 1, minorVersion: 16 }];
  const deck = { space_id: space, kind: 'flashcards', title: 'Cards', items: { cards: [{ q: '<unsafe>', a: 'Answer' }] } };
  assert.throws(() => deckParameters(deck, []));
  const converted = deckParameters(deck, libs);
  assert.equal(converted.library, 'H5P.Dialogcards 1.9');
  assert.equal((converted.params.params as any).dialogs[0].text, '<p>&lt;unsafe&gt;</p>');
  assert.throws(() => deckParameters({ ...deck, kind: 'quiz', items: { items: [{ type: 'open', question: 'Explain this' }] } }, libs), /manual grading/);
});
test('native engine round-trip saves, previews and exports with genuine library metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'set-h5p-')), old = config.dataDir; config.dataDir = dir;
  try {
    const libraryDir = join(dir, 'h5p', 'libraries', 'H5P.StudioTest-1.0');
    await mkdir(libraryDir, { recursive: true });
    await writeFile(join(libraryDir, 'library.json'), JSON.stringify({ title: 'Studio test', machineName: 'H5P.StudioTest', majorVersion: 1, minorVersion: 0, patchVersion: 0, runnable: 1, embedTypes: ['div'], license: 'MIT', preloadedJs: [{ path: 'test.js' }] }));
    await writeFile(join(libraryDir, 'semantics.json'), JSON.stringify([{ name: 'text', type: 'text', label: 'Text', widget: 'html', tags: ['p', 'strong'] }]));
    await writeFile(join(libraryDir, 'test.js'), 'H5P.StudioTest=function(p){this.attach=function(c){c.text(p.text)}};');
    const content = await forkContent(space);
    const scope = { spaceId: space, user, role: 'editor' as const, mode: 'edit' as const, readable: [content], writable: [content], allocate: content };
    const rt = await runtime(scope);
    assert.equal(await rt.editor.saveOrUpdateContent(undefined!, { text: '<p>Hello Studio</p>' }, { title: 'Native test', license: 'U' } as any, 'H5P.StudioTest 1.0', rt.user), content);
    const saved = await rt.editor.getContent(content, rt.user);
    assert.equal(saved.library, 'H5P.StudioTest 1.0');
    assert.equal(saved.params.params.text, '<p>Hello Studio</p>');
    const preview = await runtime({ ...scope, mode: 'preview' });
    assert.match(String(await preview.player.render(content, preview.user, 'en')), /Hello Studio/);
    const exported = new AdmZip(await exportContent(scope, content));
    assert.ok(exported.getEntry('H5P.StudioTest-1.0/library.json'));
    assert.equal(JSON.parse(exported.readAsText('H5P.StudioTest-1.0/library.json')).minorVersion, 0);
    assert.ok(prepareImport(exported.toBuffer()).data.length);
  } finally { config.dataDir = old; await rm(dir, { recursive: true, force: true }); }
});
