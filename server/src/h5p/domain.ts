import AdmZip from 'adm-zip';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export class StudioError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
export const libraryName = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/);
export const libraryRef = z.object({ machineName: libraryName, majorVersion: z.number().int().min(0).max(999), minorVersion: z.number().int().min(0).max(999) });
export const contentId = z.string().regex(/^[0-9]{1,16}$/);
export const placementSchema = z.object({ kind: z.enum(['page', 'notebook', 'path']), id: z.string().uuid() });
export type Placement = z.infer<typeof placementSchema>;
export const placementTargets = {
  page: { table: 'pages', column: 'page_id' },
  notebook: { table: 'notebooks', column: 'notebook_id' },
  path: { table: 'learning_paths', column: 'path_id' },
} as const;
export const saveSchema = z.object({
  library: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,127} \d{1,3}\.\d{1,3}$/),
  params: z.object({
    metadata: z.object({ title: z.string().trim().min(1).max(255) }).passthrough(),
    params: z.unknown(),
  }),
});
export const grantSchema = z.object({
  sub: z.string().uuid(), space: z.string().uuid(), activity: z.string().uuid(),
  content: contentId.nullable(), revision: z.number().int().min(0), epoch: z.number().int().min(0),
  mode: z.enum(['edit', 'preview', 'play']), nonce: z.string().uuid(), parentOrigin: z.string().url(),
});
export type Grant = z.infer<typeof grantSchema>;
export function signGrant(payload: Omit<Grant, 'nonce'>, secret: string): { token: string; nonce: string } {
  const claims = grantSchema.parse({ ...payload, nonce: randomUUID() });
  // No `id` claim: SET's normal session-token parser must never accept a launch grant.
  return { token: jwt.sign(claims, secret, { algorithm: 'HS256', expiresIn: '45m', audience: 'set:h5p', issuer: 'set' }), nonce: claims.nonce };
}
export function readGrant(token: unknown, secret: string): Grant {
  if (typeof token !== 'string' || token.length > 2048) throw new StudioError(401, 'H5P launch expired. Reopen the activity.');
  try {
    return grantSchema.parse(jwt.verify(token, secret, { algorithms: ['HS256'], audience: 'set:h5p', issuer: 'set' }));
  } catch { throw new StudioError(401, 'H5P launch expired. Reopen the activity.'); }
}
export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** One byte range, including suffix/open-ended ranges; never silently return a wrong slice. */
export function byteRange(header: string | undefined, size: number): { start: number; end: number } | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(size) || size <= 0) throw new StudioError(416, 'Invalid byte range');
  if ((match[1] && !Number.isSafeInteger(Number(match[1]))) || (match[2] && !Number.isSafeInteger(Number(match[2])))) throw new StudioError(416, 'Invalid byte range');
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size || (!match[1] && Number(match[2]) <= 0)) throw new StudioError(416, 'Invalid byte range');
  return { start, end };
}
export function safeRelativePath(name: string): boolean {
  return name.length > 0 && name.length <= 512 && !/[\\\0]/.test(name) && !name.startsWith('/') && !/^[a-z]:/i.test(name)
    && name.split('/').every((part) => part !== '..' && part !== '.');
}

/** Validate before decompression, then remove executable library code from user uploads.
 * Libraries are installed ONLY by the separate owner-only, official-Hub operation.
 */
export function prepareImport(buffer: Buffer): { data: Buffer; title: string; dependencies: z.infer<typeof libraryRef>[] } {
  if (buffer.length > 100 * 1024 * 1024) throw new StudioError(413, 'H5P packages are limited to 100 MB.');
  let archive: AdmZip;
  try { archive = new AdmZip(buffer); } catch { throw new StudioError(422, 'This is not a readable H5P package.'); }
  const entries = archive.getEntries();
  if (entries.length > 8192) throw new StudioError(413, 'Too many files in this package.');
  const seen = new Set<string>();
  let total = 0;
  for (const entry of entries) {
    const name = entry.entryName.replace(/\/$/, '');
    const unixType = (entry.attr >>> 16) & 0xf000;
    if (!safeRelativePath(name) || seen.has(name) || unixType === 0xa000 || (entry.header.flags & 1)) throw new StudioError(422, 'The package contains an unsafe, encrypted or duplicate file.');
    seen.add(name);
    total += entry.header.size;
    if (entry.header.size > 64 * 1024 * 1024 || total > 256 * 1024 * 1024) throw new StudioError(413, 'The expanded package exceeds the media limits.');
  }
  const metadataEntry = archive.getEntry('h5p.json');
  const paramsEntry = archive.getEntry('content/content.json');
  if (!metadataEntry || !paramsEntry || metadataEntry.header.size > 1024 * 1024 || paramsEntry.header.size > 8 * 1024 * 1024) throw new StudioError(422, 'An H5P package needs h5p.json and content/content.json within the metadata limits.');
  let metadata: { title: string; mainLibrary: string; preloadedDependencies: z.infer<typeof libraryRef>[] };
  try {
    metadata = z.object({ title: z.string().min(1).max(255), mainLibrary: libraryName, preloadedDependencies: z.array(libraryRef).min(1).max(512) }).parse(JSON.parse(metadataEntry.getData().toString('utf8')));
    JSON.parse(paramsEntry.getData().toString('utf8'));
  } catch { throw new StudioError(422, 'The H5P metadata or parameters are invalid.'); }
  if (!metadata.preloadedDependencies.some((d) => d.machineName === metadata.mainLibrary)) throw new StudioError(422, 'The main H5P library is missing from the dependency manifest.');
  const clean = new AdmZip();
  for (const entry of entries) {
    if (entry.isDirectory || (entry.entryName !== 'h5p.json' && !entry.entryName.startsWith('content/'))) continue;
    if (/\.(?:html?|svg|js|mjs|cjs|php|exe|sh)$/i.test(entry.entryName)) throw new StudioError(422, 'Executable content files are not accepted.');
    clean.addFile(entry.entryName, entry.getData());
  }
  return { data: clean.toBuffer(), title: metadata.title, dependencies: metadata.preloadedDependencies };
}

export const finishedSchema = z.object({
  contentId, score: z.coerce.number().finite().min(0).max(1_000_000),
  maxScore: z.coerce.number().finite().min(0).max(1_000_000),
  opened: z.coerce.number().int().min(0).max(99_999_999_999),
  finished: z.coerce.number().int().min(0).max(99_999_999_999),
  time: z.coerce.number().int().min(0).max(31_536_000).optional(),
}).refine((v) => v.score <= v.maxScore && v.finished >= v.opened, 'Invalid practice result');
