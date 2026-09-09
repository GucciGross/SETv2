import AdmZip from 'adm-zip';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { libraryRef, safeRelativePath } from './domain.js';

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const safePath = z.string().max(512).refine(p => safeRelativePath(p) && p.split('/').every(Boolean));
const fullLibrary = libraryRef.extend({ patchVersion: z.number().int().min(0).max(999) });
const library = fullLibrary.extend({
  directory: z.string(), title: z.string(), runnable: z.union([z.number(), z.boolean()]).optional(),
  files: z.array(z.object({ path: safePath, bytes: z.number().int().min(0).max(64 * 1048576), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).min(1),
}).passthrough();
const lockSchema = z.object({
  schema: z.literal(1), source: z.literal('https://api.h5p.org/v1/content-types/'),
  coreApiVersion: z.object({ major: z.literal(1), minor: z.literal(27) }),
  bundle: z.object({ file: z.literal('libraries.h5p'), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive().max(90 * 1048576) }),
  catalog: z.array(fullLibrary.extend({ title: z.string() }).passthrough()).min(1),
  libraries: z.array(library).min(1).max(1024),
});
export type BundleLock = z.infer<typeof lockSchema>;
export const bundleRoot = () => fileURLToPath(new URL('../../h5p/', import.meta.url));
export const libraryDirectory = (l: z.infer<typeof libraryRef>) => `${l.machineName}-${l.majorVersion}.${l.minorVersion}`;

export async function readBundleLock(root = bundleRoot()): Promise<BundleLock> {
  if ((await stat(join(root, 'catalog.lock.json'))).size > 16 * 1048576) throw new Error('H5P lock exceeds its size limit.');
  return lockSchema.parse(JSON.parse(await readFile(join(root, 'catalog.lock.json'), 'utf8')));
}

/** Verify the entire repository bundle before writing any executable library to DATA_DIR. */
export async function verifyBundle(root = bundleRoot()) {
  const lock = await readBundleLock(root), path = join(root, lock.bundle.file);
  if ((await stat(path)).size !== lock.bundle.bytes) throw new Error('H5P bundle size does not match its lock.');
  const bytes = await readFile(path);
  if (sha256(bytes) !== lock.bundle.sha256) throw new Error('H5P bundle checksum mismatch. Rebuild from the reviewed repository.');
  const zip = new AdmZip(bytes), expected = new Map<string, { bytes: number; sha256: string }>();
  const names = new Set<string>(); let expanded = 0;
  for (const lib of lock.libraries) {
    if (lib.directory !== libraryDirectory(lib) || names.has(lib.directory)) throw new Error('Invalid or duplicate library directory in H5P lock.');
    names.add(lib.directory);
    for (const file of lib.files) {
      const path = `${lib.directory}/${file.path}`;
      if (expected.has(path)) throw new Error('Duplicate H5P file in lock.');
      expanded += file.bytes;
      if (expanded > 512 * 1048576) throw new Error('Expanded H5P bundle exceeds 512 MB.');
      expected.set(path, file);
    }
  }
  if (zip.getEntries().length !== expected.size) throw new Error('H5P bundle contains missing or unlisted files.');
  const seen = new Set<string>();
  for (const entry of zip.getEntries()) {
    const file = expected.get(entry.entryName);
    if (!file || seen.has(entry.entryName) || entry.isDirectory || (entry.header.flags & 1) || ((entry.attr >>> 16) & 0xf000) === 0xa000 || entry.header.size !== file.bytes) throw new Error('Invalid H5P bundle entry.');
    seen.add(entry.entryName);
    if (sha256(entry.getData()) !== file.sha256) throw new Error(`H5P integrity failure: ${entry.entryName}`);
  }
  for (const lib of lock.libraries) {
    const metadata = JSON.parse(zip.readAsText(`${lib.directory}/library.json`));
    if (!isDeepStrictEqual(fullLibrary.parse(metadata), fullLibrary.parse(lib))) throw new Error('H5P metadata differs from the version lock.');
    for (const field of ['preloadedDependencies', 'editorDependencies', 'dynamicDependencies']) {
      for (const dependency of z.array(libraryRef).parse(metadata[field] ?? [])) {
        if (!names.has(libraryDirectory(dependency))) throw new Error(`${lib.directory} is missing ${libraryDirectory(dependency)}`);
      }
    }
    if (metadata.runnable && !expected.has(`${lib.directory}/semantics.json`)) throw new Error(`${lib.directory} has no authoring semantics.`);
    for (const asset of [...(metadata.preloadedJs ?? []), ...(metadata.preloadedCss ?? [])]) {
      if (!safeRelativePath(asset.path) || !expected.has(`${lib.directory}/${asset.path}`)) throw new Error(`${lib.directory} has an absent runtime asset.`);
    }
  }
  for (const type of lock.catalog) if (!names.has(libraryDirectory(type))) throw new Error(`Bundled catalog type ${type.machineName} is absent.`);
  return { lock, zip };
}

/** Refuse symlinks before reading installed files, including parent directories. */
async function regularPath(root: string, path: string): Promise<boolean> {
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('H5P storage contains a symbolic link. Operator repair required.'); }
    catch (error: any) { if (error.code === 'ENOENT') return false; throw error; }
  }
  return true;
}

let provisionQueue: Promise<unknown> = Promise.resolve();
/** Offline, idempotent provisioning. Keep old minor versions and never downgrade newer patches.
 * Files are fully staged before a directory switch; rollback on a failed rename. Run before listen.
 */
export function provisionBundledLibraries(target: string, root = bundleRoot()) {
  const next = provisionQueue.then(async () => {
    const { lock, zip } = await verifyBundle(root);
    await mkdir(target, { recursive: true });
    if ((await lstat(target)).isSymbolicLink()) throw new Error('H5P library root must not be a symbolic link.');
    const changed: string[] = [], preserved: string[] = [];
    for (const lib of lock.libraries) {
      const path = join(target, lib.directory);
      let current: any;
      if (await regularPath(target, `${lib.directory}/library.json`)) {
        try { current = JSON.parse(await readFile(join(path, 'library.json'), 'utf8')); }
        catch (error: any) { if (!(error instanceof SyntaxError)) throw error; }
      }
      if (current?.patchVersion > lib.patchVersion) { preserved.push(lib.directory); continue; }
      let intact = current?.patchVersion === lib.patchVersion;
      if (intact) for (const file of lib.files) {
        if (!(await regularPath(target, `${lib.directory}/${file.path}`))) { intact = false; break; }
        const data = await readFile(join(path, file.path));
        if (file.path === 'library.json') {
          // Native administration may change restriction flags or JSON formatting.
          const { restricted: _a, ...actual } = current;
          const { restricted: _b, ...expected } = JSON.parse(zip.readAsText(`${lib.directory}/library.json`));
          if (!isDeepStrictEqual(actual, expected)) { intact = false; break; }
        } else if (data.length !== file.bytes || sha256(data) !== file.sha256) { intact = false; break; }
      }
      if (intact) continue;
      const stage = await mkdtemp(join(target, '.set-stage-')), backup = `${path}.backup-${randomUUID()}`;
      let backedUp = false;
      try {
        for (const file of lib.files) {
          const out = join(stage, file.path);
          await mkdir(dirname(out), { recursive: true });
          let data = zip.getEntry(`${lib.directory}/${file.path}`)!.getData();
          if (file.path === 'library.json' && typeof current?.restricted === 'boolean') data = Buffer.from(JSON.stringify({ ...JSON.parse(data.toString()), restricted: current.restricted }));
          await writeFile(out, data, { flag: 'wx' });
        }
        try { await rename(path, backup); backedUp = true; } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
        try { await rename(stage, path); } catch (error) { if (backedUp) await rename(backup, path); throw error; }
        if (backedUp) await rm(backup, { recursive: true, force: true });
        changed.push(lib.directory);
      } finally { await rm(stage, { recursive: true, force: true }); }
    }
    return { contentTypes: lock.catalog.length, libraries: lock.libraries.length, changed, preserved, sha256: lock.bundle.sha256 };
  });
  provisionQueue = next.catch(() => {});
  return next;
}
