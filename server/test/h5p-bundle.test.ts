import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { fsImplementations } from '@lumieducation/h5p-server';
import Fastify from 'fastify';
import { provisionBundledLibraries, verifyBundle } from '../src/h5p/bundle.js';
import { libraryInventory, requireUsableLibrary } from '../src/h5p/libraries.js';
import { h5pNativeAssetRoutes } from '../src/h5p/native-assets.js';

const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'set-bundle-'));
  const meta = { machineName: 'H5P.BundleTest', title: 'Bundle test', majorVersion: 1, minorVersion: 0, patchVersion: 2, runnable: 1, preloadedJs: [{ path: 'test.js' }] };
  const content: Record<string, string> = { 'library.json': JSON.stringify(meta), 'semantics.json': '[]', 'test.js': '/* trusted fixture */' };
  const zip = new AdmZip();
  const files = Object.entries(content).map(([path, text]) => { const data = Buffer.from(text); zip.addFile('H5P.BundleTest-1.0/' + path, data); return { path, bytes: data.length, sha256: hash(data) }; });
  const bytes = zip.toBuffer();
  const lock = { schema: 1, source: 'https://api.h5p.org/v1/content-types/', coreApiVersion: { major: 1, minor: 27 }, bundle: { file: 'libraries.h5p', bytes: bytes.length, sha256: hash(bytes) }, catalog: [meta], libraries: [{ ...meta, directory: 'H5P.BundleTest-1.0', files }] };
  await writeFile(join(root, 'libraries.h5p'), bytes); await writeFile(join(root, 'catalog.lock.json'), JSON.stringify(lock));
  return { root, lock, target: join(root, 'installed'), meta };
}

test('repository H5P bundle contains the complete pinned catalog and all dependency files', async () => {
  const { lock } = await verifyBundle();
  assert.equal(lock.catalog.length, 53);
  assert.equal(lock.libraries.length, 145);
  for (const name of ['H5P.GameMap', 'H5P.BranchingScenario', 'H5P.CoursePresentation', 'H5P.InteractiveVideo']) assert.ok(lock.catalog.some(l => l.machineName === name));
});
test('offline provisioning is idempotent, repairs corrupted files and preserves newer/older versions', async () => {
  const { root, target, meta } = await fixture();
  try {
    assert.equal((await provisionBundledLibraries(target, root)).changed.length, 1);
    assert.equal((await provisionBundledLibraries(target, root)).changed.length, 0);
    const file = join(target, 'H5P.BundleTest-1.0', 'test.js');
    await writeFile(file, 'corrupt');
    assert.equal((await provisionBundledLibraries(target, root)).changed.length, 1);
    assert.equal(await readFile(file, 'utf8'), '/* trusted fixture */');
    await mkdir(join(target, 'H5P.BundleTest-0.9'));
    await writeFile(join(target, 'H5P.BundleTest-0.9', 'keep.txt'), 'old content still needs this');
    await writeFile(join(target, 'H5P.BundleTest-1.0', 'library.json'), JSON.stringify({ ...meta, patchVersion: 3 }));
    assert.deepEqual((await provisionBundledLibraries(target, root)).preserved, ['H5P.BundleTest-1.0']);
    assert.equal(await readFile(join(target, 'H5P.BundleTest-0.9', 'keep.txt'), 'utf8'), 'old content still needs this');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('bundle integrity failure never writes libraries', async () => {
  const { root, target } = await fixture();
  try { await writeFile(join(root, 'libraries.h5p'), 'bad'); await assert.rejects(provisionBundledLibraries(target, root), /size|checksum/); await assert.rejects(readFile(join(target, 'H5P.BundleTest-1.0', 'library.json'))); }
  finally { await rm(root, { recursive: true, force: true }); }
});
test('provisioning rejects symbolic links instead of following them', async () => {
  const { root, target } = await fixture();
  try { await mkdir(target); await symlink(root, join(target, 'H5P.BundleTest-1.0')); await assert.rejects(provisionBundledLibraries(target, root), /symbolic link/); }
  finally { await rm(root, { recursive: true, force: true }); }
});
test('readiness requires semantics, runtime assets and transitive dependencies, not just a folder', async () => {
  const { root, target, meta } = await fixture();
  try {
    await provisionBundledLibraries(target, root);
    const storage = new fsImplementations.FileLibraryStorage(target);
    assert.equal((await libraryInventory(storage))[0].usable, true);
    await rm(join(target, 'H5P.BundleTest-1.0', 'test.js'));
    await assert.rejects(requireUsableLibrary(storage, meta), /Missing asset/);
    await provisionBundledLibraries(target, root);
    await writeFile(join(target, 'H5P.BundleTest-1.0', 'library.json'), JSON.stringify({ ...meta, editorDependencies: [{ machineName: 'H5P.MissingWidget', majorVersion: 1, minorVersion: 0 }] }));
    await assert.rejects(requireUsableLibrary(storage, meta), /Missing dependency/);
    await writeFile(join(target, 'H5P.BundleTest-1.0', 'semantics.json'), '{broken');
    assert.match((await libraryInventory(storage))[0].issues.join(' '), /semantics/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('native public assets cannot expose content, settings, traversal or executable uploads', async () => {
  const app = Fastify(); await h5pNativeAssetRoutes(app);
  try { for (const url of ['/h5p/assets/native/content/private/content.json', '/h5p/assets/native/settings/settings.json', '/h5p/assets/native/libraries/..%2fsettings.json', '/h5p/assets/native/editor/README.md']) assert.equal((await app.inject(url)).statusCode, 404, url); }
  finally { await app.close(); }
});
