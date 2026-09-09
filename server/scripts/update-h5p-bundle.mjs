/** Maintainer-only refresh. Downloads official Hub code as data; never evaluates package scripts.
 * Commit the resulting bundle and lock together. Production never resolves moving Hub URLs.
 */
import * as H5P from '@lumieducation/h5p-server';
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const destination = fileURLToPath(new URL('../h5p/', import.meta.url));
const storage = new H5P.fsImplementations.InMemoryStorage();
const config = new H5P.H5PConfig(storage);
config.platformName = 'SET'; config.sendUsageStatistics = false;
const catalog = await new H5P.ContentTypeCache(config, storage).get();
if (!catalog.length) throw new Error('The official H5P Hub returned no content types. Existing pins are unchanged.');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const nameOf = (lib) => `${lib.machineName}-${lib.majorVersion}.${lib.minorVersion}`;
const validPath = (path) => path && !/[\\\0:]/.test(path) && !path.startsWith('/') && path.split('/').every(p => p && p !== '.' && p !== '..');
const libs = new Map(), sources = [];
for (const type of catalog.sort((a, b) => a.machineName.localeCompare(b.machineName))) {
  if (!/^[A-Za-z][A-Za-z0-9_.-]+$/.test(type.machineName)) throw new Error('Invalid Hub machine name');
  const url = 'https://api.h5p.org/v1/content-types/' + type.machineName;
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { response = await fetch(url, { signal: AbortSignal.timeout(90_000) }); if (response.ok) break; } catch (e) { if (attempt === 2) throw e; }
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
  }
  if (!response?.ok) throw new Error(`${type.machineName}: HTTP ${response?.status}`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 96 * 1024 * 1024) throw new Error('Hub package exceeds 96 MB'); chunks.push(chunk); }
  const data = Buffer.concat(chunks), zip = new AdmZip(data), entries = zip.getEntries();
  let expanded = 0; const seen = new Set();
  if (entries.length > 20000) throw new Error('Too many Hub package files');
  for (const e of entries) {
    const p = e.entryName.replace(/\/$/, ''); expanded += e.header.size;
    if (!validPath(p) || seen.has(p) || (e.header.flags & 1) || ((e.attr >>> 16) & 0xf000) === 0xa000 || expanded > 384 * 1024 * 1024) throw new Error('Unsafe Hub archive');
    seen.add(p);
  }
  sources.push({ machineName: type.machineName, url, sha256: digest(data), bytes: data.length });
  for (const entry of entries.filter(e => /^[^/]+\/library\.json$/.test(e.entryName))) {
    const meta = JSON.parse(entry.getData().toString());
    if (!/^[A-Za-z][A-Za-z0-9_.-]+$/.test(meta.machineName) || !['majorVersion', 'minorVersion', 'patchVersion'].every(k => Number.isInteger(meta[k]) && meta[k] >= 0 && meta[k] <= 999)) throw new Error('Invalid library version');
    if (meta.coreApi && (meta.coreApi.major > config.coreApiVersion.major || (meta.coreApi.major === config.coreApiVersion.major && meta.coreApi.minor > config.coreApiVersion.minor))) throw new Error(`${nameOf(meta)} needs a newer H5P core; update the tested core/editor pair first`);
    const key = nameOf(meta), old = libs.get(key), prefix = entry.entryName.slice(0, -'library.json'.length);
    if (old && old.meta.patchVersion >= meta.patchVersion) continue;
    const files = entries.filter(e => !e.isDirectory && e.entryName.startsWith(prefix)).map(e => ({ path: e.entryName.slice(prefix.length), data: e.getData() }));
    for (const asset of [...(meta.preloadedJs ?? []), ...(meta.preloadedCss ?? [])]) {
      if (!validPath(asset.path) || !files.some(f => f.path === asset.path)) throw new Error(`${key}: missing asset ${asset.path}`);
    }
    if (meta.runnable && !files.some(f => f.path === 'semantics.json')) throw new Error(`${key}: missing authoring semantics`);
    libs.set(key, { meta, files });
  }
  console.log(`Downloaded ${type.machineName}; ${libs.size} unique library versions`);
}
for (const { meta } of libs.values()) for (const dependency of [...(meta.preloadedDependencies ?? []), ...(meta.editorDependencies ?? []), ...(meta.dynamicDependencies ?? [])]) {
  if (!libs.has(nameOf(dependency))) throw new Error(`${nameOf(meta)} requires absent ${nameOf(dependency)}`);
}
for (const type of catalog) if (!libs.has(nameOf(type))) throw new Error(`Missing advertised content type ${nameOf(type)}`);
const bundle = new AdmZip(), libraries = [];
for (const [directory, lib] of [...libs].sort(([a], [b]) => a.localeCompare(b))) {
  const files = [];
  for (const file of lib.files.sort((a, b) => a.path.localeCompare(b.path))) {
    const path = directory + '/' + file.path;
    bundle.addFile(path, file.data);
    bundle.getEntry(path).header.time = new Date('2020-01-01T00:00:00Z');
    files.push({ path: file.path, bytes: file.data.length, sha256: digest(file.data) });
  }
  libraries.push({ ...lib.meta, directory, files });
}
const bytes = bundle.toBuffer();
if (bytes.length > 90 * 1024 * 1024) throw new Error('Bundle exceeds repository size budget. Split it before committing.');
const lock = { schema: 1, source: config.hubContentTypesEndpoint, coreApiVersion: config.coreApiVersion, bundle: { file: 'libraries.h5p', sha256: digest(bytes), bytes: bytes.length }, catalog, sources, libraries };
await mkdir(destination, { recursive: true });
await writeFile(resolve(destination, 'libraries.h5p'), bytes);
await writeFile(resolve(destination, 'catalog.lock.json'), JSON.stringify(lock, null, 2) + '\n');
console.log(`Locked ${catalog.length} content types, ${libs.size} library versions, ${(bytes.length / 1048576).toFixed(1)} MB. Review licenses and commit both files.`);
