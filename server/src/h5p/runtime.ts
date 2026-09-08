import * as H5P from '@lumieducation/h5p-server';
import { access, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { randomInt } from 'node:crypto';
import { resolve, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { config } from '../config.js';
import type { JwtUser } from '../lib/tokens.js';
import type { Role } from '../lib/http.js';
import { contentId, StudioError } from './domain.js';
import { PostgresUserData } from './user-data.js';

export const h5pRoot = () => resolve(config.dataDir, 'h5p');
export const coreRoot = () => resolve(process.env.H5P_ASSETS_DIR || './h5p-assets');
export const contentRoot = (spaceId: string) => join(h5pRoot(), 'spaces', spaceId, 'content');
const cache = new H5P.fsImplementations.InMemoryStorage();
const lockProvider = new H5P.SimpleLockProvider();

export interface RuntimeScope {
  spaceId: string;
  user: JwtUser;
  role: Role;
  mode: 'edit' | 'preview' | 'play';
  readable: string[];
  writable?: string[];
  installFromHub?: boolean;
  allocate?: string;
}
export function permissions(scope: RuntimeScope): H5P.IPermissionSystem {
  const author = scope.role !== 'viewer' && scope.mode === 'edit';
  const reads = new Set(scope.readable);
  const writes = new Set(scope.writable ?? []);
  const own = (user: H5P.IUser) => user?.id === scope.user.id;
  return {
    async checkForContent(user, permission, id) {
      if (!own(user)) return false;
      if (permission === H5P.ContentPermission.Create) return author;
      if (permission === H5P.ContentPermission.List) return false;
      if (!id) return false;
      if ([H5P.ContentPermission.Edit, H5P.ContentPermission.Delete].includes(permission)) return author && writes.has(id);
      return reads.has(id) || (author && writes.has(id));
    },
    async checkForGeneralAction(user, permission) {
      if (!own(user) || !author || scope.role !== 'owner') return false;
      if (permission === H5P.GeneralPermission.InstallRecommended) return true;
      return permission === H5P.GeneralPermission.UpdateAndInstallLibraries && scope.installFromHub === true;
    },
    async checkForTemporaryFile(user) { return own(user) && author; },
    async checkForUserData(user, _permission, id, affectedUserId) {
      return own(user) && scope.mode === 'play' && reads.has(id) && (!affectedUserId || affectedUserId === user.id);
    },
  };
}

/** Reserve SET's revision id while allowing the native engine to use its NEW-content path. */
class RevisionStorage extends H5P.fsImplementations.FileContentStorage {
  constructor(directory: string, private readonly reserved?: string) { super(directory); }
  override async addContent(metadata: H5P.IContentMetadata, params: H5P.ContentParameters, user: H5P.IUser, id?: string): Promise<string> {
    return super.addContent(metadata, params, user, id ?? this.reserved);
  }
}

/** A request-scoped adapter over shared library/cache/locks and space-scoped content files.
 * No runtime object (and therefore no launch URL or permissions) is shared between users.
 */
export async function runtime(scope: RuntimeScope, baseUrl = '/api/h5p/internal') {
  await Promise.all([
    mkdir(join(h5pRoot(), 'libraries'), { recursive: true }),
    mkdir(contentRoot(scope.spaceId), { recursive: true }),
    mkdir(join(h5pRoot(), 'spaces', scope.spaceId, 'temporary'), { recursive: true }),
  ]);
  await writeFile(join(h5pRoot(), 'settings.json'), '{}', { flag: 'wx', mode: 0o600 }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
  const settings = await new H5P.H5PConfig(new H5P.fsImplementations.JsonStorage(join(h5pRoot(), 'settings.json'))).load();
  settings.baseUrl = baseUrl;
  settings.platformName = 'SET';
  settings.platformVersion = '2.1';
  settings.sendUsageStatistics = false;
  settings.contentHubEnabled = false;
  settings.maxFileSize = 64 * 1024 * 1024;
  settings.maxTotalSize = 256 * 1024 * 1024;
  settings.contentUserStateSaveInterval = scope.mode === 'play' ? 10_000 : 0;
  settings.setFinishedEnabled = scope.mode === 'play';
  // Keep uploaded active documents out of the content origin. Trusted library SVGs are separate.
  settings.contentWhitelist = 'json png jpg jpeg gif bmp tif tiff eot ttf woff woff2 otf webm mp4 ogg mp3 m4a wav txt pdf rtf doc docx xls xlsx ppt pptx odt ods odp xml csv md vtt webvtt gltf glb';
  const libraryStorage = new H5P.fsImplementations.FileLibraryStorage(join(h5pRoot(), 'libraries'));
  const contentStorage = new RevisionStorage(contentRoot(scope.spaceId), scope.allocate);
  const temporaryStorage = new H5P.fsImplementations.DirectoryTemporaryFileStorage(join(h5pRoot(), 'spaces', scope.spaceId, 'temporary'));
  const permissionSystem = permissions(scope);
  const userData = scope.mode === 'play' ? new PostgresUserData(scope.spaceId) : undefined;
  const user: H5P.IUser = { ...scope.user, email: '', type: 'local' };
  const urls = new H5P.UrlGenerator(settings);
  const editor = new H5P.H5PEditor(cache, settings, libraryStorage, contentStorage, temporaryStorage, undefined, urls, { permissionSystem, lockProvider }, userData);
  const player = new H5P.H5PPlayer(libraryStorage, contentStorage, settings, undefined, urls, undefined, { permissionSystem }, userData);
  const ajax = new H5P.H5PAjaxEndpoint(editor);
  return { editor, player, ajax, user, libraryStorage, userData };
}
export async function runtimeReady(): Promise<boolean> {
  try {
    await Promise.all([access(join(coreRoot(), 'core', 'js', 'h5p.js')), access(join(coreRoot(), 'editor', 'scripts', 'h5peditor.js'))]);
    return true;
  } catch { return false; }
}
export async function requireRuntimeAssets(): Promise<void> {
  if (!(await runtimeReady())) throw new StudioError(503, 'The H5P browser runtime is not installed. Run npm run h5p:setup in server, or rebuild the server image.');
}

/** Allocate an immutable revision. Copy first so existing media references remain valid. */
export async function forkContent(spaceId: string, source?: string | null): Promise<string> {
  await mkdir(contentRoot(spaceId), { recursive: true });
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = String(randomInt(1_000_000_000_000, 9_000_000_000_000));
    const target = join(contentRoot(spaceId), id);
    try { await mkdir(target); } catch (error: any) { if (error.code === 'EEXIST') continue; throw error; }
    try {
      if (source) await cp(join(contentRoot(spaceId), contentId.parse(source)), target, { recursive: true, errorOnExist: false });
      return id;
    } catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
  }
  throw new StudioError(503, 'Could not allocate an activity revision. Try again.');
}
export async function removeContent(spaceId: string, id: string): Promise<void> {
  await rm(join(contentRoot(spaceId), contentId.parse(id)), { recursive: true, force: true });
}
export async function exportContent(scope: RuntimeScope, id: string): Promise<Buffer> {
  const rt = await runtime(scope);
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  let size = 0;
  stream.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > 384 * 1024 * 1024) stream.destroy(new StudioError(413, 'The exported package is too large.'));
    else chunks.push(chunk);
  });
  const complete = new Promise<void>((resolve, reject) => { stream.on('end', resolve); stream.on('error', reject); });
  const exporting = rt.ajax.getDownload(id, rt.user, stream).catch((error) => { stream.destroy(error); throw error; });
  await Promise.all([complete, exporting]);
  return Buffer.concat(chunks);
}
