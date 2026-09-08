import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { config } from '../config.js';
import { one, q } from '../db.js';
import { requireUser } from '../lib/http.js';
import { activityFor, archiveActivity, attachActivity, authorizeGrant, copyRevision, createActivity, exportActivity, importActivity, listActivities, publishActivity, revisionFor, saveActivity, spaceRole, summary } from './service.js';
import { byteRange, finishedSchema, libraryName, placementSchema, prepareImport, readGrant, safeRelativePath, saveSchema, signGrant, StudioError } from './domain.js';
import { coreRoot, exportContent, requireRuntimeAssets, runtime, runtimeReady } from './runtime.js';
import { editorDocument, playerDocument } from './render.js';
import { createFromDeck } from './from-deck.js';

const id = (req: FastifyRequest) => z.string().uuid().parse((req.params as any).id);
const space = (req: FastifyRequest) => z.string().uuid().parse((req.params as any).spaceId);
const expectedSchema = z.object({ expectedRevision: z.number().int().min(0) });
const filename = (title: string) => `${title.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'activity'}.h5p`;

function errors(app: FastifyInstance) {
  app.setErrorHandler((error: any, _req, reply) => {
    const proposed = error instanceof z.ZodError ? 422 : error.statusCode ?? error.httpStatusCode ?? 500;
    const status = Number.isInteger(proposed) && proposed >= 400 && proposed <= 599 ? proposed : 500;
    if (status >= 500) app.log.error({ message: error.message, name: error.name }, 'H5P operation failed');
    reply.code(status).send({ error: error instanceof z.ZodError ? 'Invalid H5P request.' : status >= 500 && !(error instanceof StudioError) ? 'The H5P operation failed. Check the server logs and installed libraries.' : error.message });
  });
}
async function upload(req: FastifyRequest) {
  const fields: Record<string, any> = {};
  let file: { data: Buffer; name: string; mimetype: string; size: number } | undefined;
  for await (const part of req.parts({ limits: { files: 1, fileSize: 100 * 1024 * 1024, fields: 16, fieldSize: 1024 * 1024 } })) {
    if (part.type === 'file') {
      const data = await part.toBuffer();
      if (part.file.truncated) throw new StudioError(413, 'The upload exceeds 100 MB.');
      file = { data, name: part.filename, mimetype: part.mimetype, size: data.length };
    } else fields[part.fieldname] = part.value;
  }
  return { fields, file };
}
export async function h5pRoutes(app: FastifyInstance) {
  // Management uses the existing SET bearer session and normal workspace roles.
  await app.register(async (studio) => {
    errors(studio);
    studio.addHook('preHandler', async (req, reply) => { await requireUser(req, reply); });
    studio.get('/spaces/:spaceId/h5p/status', async (req) => {
      const spaceId = space(req), role = await spaceRole(spaceId, req.user!.id);
      const rt = await runtime({ spaceId, user: req.user!, role, mode: 'preview', readable: [] });
      const names = await rt.libraryStorage.getInstalledLibraryNames();
      const installed = await Promise.all(names.map(async (name) => {
        const library = await rt.libraryStorage.getLibrary(name);
        return { ...name, title: library.title, runnable: library.runnable };
      }));
      return { ready: await runtimeReady(), canEdit: role !== 'viewer', canInstall: role === 'owner', installed: installed.filter((l) => l.runnable), maxPackageMB: 100, maxMediaMB: 64 };
    });
    studio.get('/spaces/:spaceId/h5p/catalog', async (req) => {
      const spaceId = space(req), role = await spaceRole(spaceId, req.user!.id);
      const rt = await runtime({ spaceId, user: req.user!, role, mode: 'edit', readable: [] });
      return { catalog: await rt.editor.getContentTypeCache(rt.user), canInstall: role === 'owner' };
    });
    studio.post('/spaces/:spaceId/h5p/libraries', async (req) => {
      const spaceId = space(req), role = await spaceRole(spaceId, req.user!.id, 'owner');
      const body = z.object({ machineName: libraryName }).parse(req.body);
      const rt = await runtime({ spaceId, user: req.user!, role, mode: 'edit', readable: [], installFromHub: true });
      return { installed: await rt.editor.installLibraryFromHub(body.machineName, rt.user) };
    });
    studio.get('/spaces/:spaceId/h5p/activities', async (req) => {
      const options = z.object({ search: z.string().max(100).optional(), offset: z.coerce.number().int().min(0).max(100000).optional(), archived: z.enum(['true', 'false']).optional(), status: z.enum(['all', 'draft', 'published']).optional(), kind: placementSchema.shape.kind.optional(), parentId: z.string().uuid().optional() }).parse(req.query);
      if (!!options.kind !== !!options.parentId) throw new StudioError(422, 'A placement needs both its kind and destination.');
      return listActivities(space(req), req.user!.id, { ...options, archived: options.archived === 'true', placement: options.kind ? { kind: options.kind, id: options.parentId! } : undefined });
    });
    studio.post('/spaces/:spaceId/h5p/activities', async (req) => {
      const body = z.object({ title: z.string().trim().min(1).max(255).default('Untitled activity'), placement: placementSchema.optional() }).parse(req.body ?? {});
      return { activity: await createActivity(space(req), req.user!, body.title, body.placement) };
    });
    studio.post('/spaces/:spaceId/h5p/import', async (req) => {
      const spaceId = space(req);
      await spaceRole(spaceId, req.user!.id, 'editor');
      const { fields, file } = await upload(req);
      if (!file || !/\.h5p$/i.test(file.name)) throw new StudioError(422, 'Choose a .h5p package.');
      const placement = fields.kind || fields.parentId ? placementSchema.parse({ kind: fields.kind, id: fields.parentId }) : undefined;
      return { activity: await importActivity(spaceId, req.user!, file.data, placement) };
    });
    studio.post('/decks/:id/h5p/activity', async (req) => ({ activity: await createFromDeck(id(req), req.user!) }));
    studio.get('/h5p/activities/:id', async (req) => ({ activity: summary(await activityFor(id(req), req.user!.id)) }));
    studio.get('/h5p/activities/:id/export', async (req, reply) => {
      const result = await exportActivity(id(req), req.user!);
      return reply.type('application/zip').header('Content-Disposition', `attachment; filename="${filename(result.title)}"`).header('Cache-Control', 'no-store').send(result.data);
    });
    studio.post('/h5p/activities/:id/publish', async (req) => ({ activity: await publishActivity(id(req), req.user!, expectedSchema.parse(req.body).expectedRevision) }));
    studio.post('/h5p/activities/:id/unpublish', async (req) => ({ activity: await publishActivity(id(req), req.user!, expectedSchema.parse(req.body).expectedRevision, false) }));
    studio.patch('/h5p/activities/:id', async (req) => ({ activity: await archiveActivity(id(req), req.user!, z.object({ archived: z.boolean() }).parse(req.body).archived) }));
    studio.put('/h5p/activities/:id/placements', async (req) => attachActivity(id(req), req.user!, placementSchema.parse(req.body)));
    studio.post('/h5p/activities/:id/placements/remove', async (req) => attachActivity(id(req), req.user!, placementSchema.parse(req.body), true));
    studio.get('/h5p/activities/:id/revisions', async (req) => {
      const row = await activityFor(id(req), req.user!.id);
      if (row.role === 'viewer') throw new StudioError(403, 'Requires editor access.');
      return { revisions: await q(`SELECT r.revision,r.title,r.library,r.created_at,r.published_at,u.name AS author FROM h5p_revisions r LEFT JOIN users u ON u.id=r.created_by WHERE r.activity_id=$1 ORDER BY r.revision DESC LIMIT 100`, [row.id]) };
    });
    studio.post('/h5p/activities/:id/restore', async (req) => {
      const body = expectedSchema.extend({ revision: z.number().int().positive() }).parse(req.body);
      return { activity: await copyRevision(id(req), req.user!, body.revision, body.expectedRevision, false) };
    });
    studio.post('/h5p/activities/:id/duplicate', async (req) => {
      const row = await activityFor(id(req), req.user!.id);
      return { activity: await copyRevision(row.id, req.user!, row.draft_revision, row.draft_revision, true) };
    });
    studio.get('/h5p/activities/:id/results', async (req) => {
      const row = await activityFor(id(req), req.user!.id);
      const results = await q(`SELECT r.revision,u.name AS learner,f.score,f.max_score,f.completion_time,f.updated_at FROM h5p_finished f
        JOIN h5p_revisions r ON r.content_id=f.content_id JOIN users u ON u.id=f.user_id
        WHERE r.activity_id=$1 AND ($2::uuid IS NULL OR f.user_id=$2) ORDER BY f.updated_at DESC LIMIT 200`, [row.id, row.role === 'viewer' ? req.user!.id : null]);
      return { results, authoritative: false, description: 'Latest client-reported practice results. These do not change assessed grades, certifications or path completion.' };
    });
    studio.post('/h5p/activities/:id/launch', async (req) => {
      const row = await activityFor(id(req), req.user!.id);
      if (row.archived) throw new StudioError(409, 'Restore this activity before opening it.');
      const { mode } = z.object({ mode: z.enum(['edit', 'preview', 'play']) }).parse(req.body);
      if (mode !== 'play' && row.role === 'viewer') throw new StudioError(403, 'Requires editor access.');
      const number = mode === 'play' ? row.published_revision : row.draft_revision;
      if (!number && mode !== 'edit') throw new StudioError(409, mode === 'play' ? 'This activity is not published.' : 'Save a draft before previewing.');
      const revision = number ? await revisionFor(row.id, number) : undefined;
      await requireRuntimeAssets();
      const parentOrigin = new URL(typeof req.headers.origin === 'string' && req.headers.origin !== 'null' ? req.headers.origin : config.appUrl).origin;
      const grant = signGrant({ sub: req.user!.id, space: row.space_id, activity: row.id, content: revision?.content_id ?? null, revision: number ?? 0, epoch: row.access_epoch, mode, parentOrigin }, config.jwtSecret);
      return { url: `/api/h5p/runtime/${grant.token}/${mode === 'edit' ? 'editor' : 'play'}`, nonce: grant.nonce, expiresAt: new Date(Date.now() + 45 * 60_000).toISOString() };
    });
  });

  // Dedicated short-lived capabilities, never SET login tokens. Do not log capability URLs.
  await app.register(async (native) => {
    errors(native);
    native.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, text, done) => {
      const body: Record<string, any> = Object.create(null);
      for (const [key, value] of new URLSearchParams(text as string)) {
        if (key.endsWith('[]')) { const name = key.slice(0, -2); (body[name] ??= []).push(value); }
        else body[key] = value;
      }
      done(null, body);
    });
    native.addHook('onRequest', async (_req, reply) => {
      reply.header('Referrer-Policy', 'no-referrer').header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    });
    async function context(req: FastifyRequest, edit = false) {
      const token = (req.params as any).grant;
      const grant = readGrant(token, config.jwtSecret);
      const ctx = await authorizeGrant(grant);
      if (edit && grant.mode !== 'edit') throw new StudioError(403, 'This launch is read-only.');
      const base = `/api/h5p/runtime/${token}`;
      return { ...ctx, grant, base };
    }
    function matching(actual: unknown, expected: string | null) {
      if (typeof actual !== 'string' || actual !== expected) throw new StudioError(403, 'This launch cannot access another activity.');
      return actual;
    }
    native.get('/:grant/editor', async (req, reply) => {
      const ctx = await context(req, true);
      await requireRuntimeAssets();
      const rt = await runtime(ctx.scope, ctx.base);
      rt.editor.setRenderer((model) => editorDocument(model, ctx.grant, ctx.base));
      return reply.type('text/html; charset=utf-8').send(await rt.editor.render(ctx.grant.content ?? '', 'en', rt.user));
    });
    native.get('/:grant/play', async (req, reply) => {
      const ctx = await context(req);
      if (!ctx.grant.content) throw new StudioError(409, 'Save the activity first.');
      const rt = await runtime(ctx.scope, ctx.base);
      rt.player.setRenderer((model) => playerDocument(model, ctx.grant));
      return reply.type('text/html; charset=utf-8').send(await rt.player.render(ctx.grant.content, rt.user, 'en'));
    });
    native.post('/:grant/save', { bodyLimit: 8 * 1024 * 1024 }, async (req) => {
      const ctx = await context(req, true);
      return { activity: await saveActivity(ctx.grant.activity, ctx.user, ctx.grant.revision, saveSchema.parse(req.body)) };
    });
    native.get('/:grant/params/:contentId', async (req) => {
      const ctx = await context(req, true);
      const target = matching((req.params as any).contentId, ctx.grant.content);
      const rt = await runtime(ctx.scope, ctx.base);
      return rt.ajax.getContentParameters(target, rt.user);
    });
    native.get('/:grant/ajax', async (req) => {
      const ctx = await context(req, true);
      const query = z.object({ action: z.enum(['content-type-cache', 'libraries', 'content-hub-metadata-cache']), machineName: libraryName.optional(), majorVersion: z.coerce.number().int().min(0).max(999).optional(), minorVersion: z.coerce.number().int().min(0).max(999).optional(), language: z.string().max(24).optional() }).parse(req.query);
      // The pinned hub client requests hub metadata even when the Hub is disabled and rejects every
      // metadata promise (page errors) unless success+data arrive. SET is self-hosted and never calls
      // h5p.org, so the taxonomies are answered locally and empty.
      if (query.action === 'content-hub-metadata-cache') return { success: true, data: { levels: [], languages: [], licenses: [], disciplines: [] } };
      const rt = await runtime(ctx.scope, ctx.base);
      return rt.ajax.getAjax(query.action, query.machineName, query.majorVersion, query.minorVersion, query.language ?? 'en', rt.user);
    });
    native.post('/:grant/ajax', { bodyLimit: 8 * 1024 * 1024 }, async (req) => {
      const ctx = await context(req, true);
      const query = z.object({ action: z.enum(['libraries', 'translations', 'files', 'filter', 'library-install', 'library-upload']), id: libraryName.optional() }).parse(req.query);
      if (query.action === 'library-install' && ctx.row.role !== 'owner') throw new StudioError(403, 'Only a workspace owner can install content types.');
      const rt = await runtime({ ...ctx.scope, installFromHub: query.action === 'library-install' }, ctx.base);
      const input = req.isMultipart() ? await upload(req) : { fields: req.body as any ?? {}, file: undefined };
      if (query.action === 'library-upload') {
        if (!input.file) throw new StudioError(422, 'Choose an H5P package.');
        const clean = prepareImport(input.file.data);
        const missing = await rt.editor.libraryManager.getNotInstalledLibraries(clean.dependencies);
        if (missing.length) throw new StudioError(422, 'This package needs libraries that are not installed. Ask an owner to install matching versions from the content catalog.');
        input.file = { ...input.file, data: clean.data, size: clean.data.length };
      }
      return rt.ajax.postAjax(query.action, input.fields, 'en', rt.user, query.action === 'files' ? input.file : undefined, query.id, undefined, query.action === 'library-upload' ? input.file : undefined);
    });
    for (const kind of ['core', 'editor'] as const) {
      native.get(`/:grant/${kind}/*`, async (req, reply) => {
        await context(req);
        const name = String((req.params as any)['*']);
        if (!safeRelativePath(name)) throw new StudioError(404, 'Asset not found.');
        const root = resolve(coreRoot(), kind), file = resolve(root, name);
        if (!file.startsWith(root + sep)) throw new StudioError(404, 'Asset not found.');
        const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject', '.otf': 'font/otf' };
        const type = types[extname(file).toLowerCase()];
        if (!type) throw new StudioError(404, 'Asset not found.');
        try { const info = await stat(file); if (!info.isFile()) throw new Error(); }
        catch { throw new StudioError(404, 'H5P browser asset not found. Reinstall the pinned runtime assets.'); }
        return reply.type(type).send(createReadStream(file));
      });
    }
    native.get('/:grant/libraries/:library/*', async (req, reply) => {
      const ctx = await context(req), p = req.params as any;
      if (!safeRelativePath(String(p['*'])) || !/^[A-Za-z][A-Za-z0-9_.-]*-\d+\.\d+$/.test(p.library)) throw new StudioError(404, 'Library file not found.');
      const rt = await runtime(ctx.scope, ctx.base);
      const file = await rt.ajax.getLibraryFile(p.library, p['*']);
      return reply.type(file.mimetype).send(file.stream);
    });
    for (const kind of ['content', 'temp-files'] as const) {
      native.get(kind === 'content' ? '/:grant/content/:contentId/*' : '/:grant/temp-files/*', async (req, reply) => {
        const ctx = await context(req, kind === 'temp-files'), p = req.params as any;
        if (!safeRelativePath(String(p['*']))) throw new StudioError(404, 'Media not found.');
        const rt = await runtime(ctx.scope, ctx.base);
        const range = (size: number) => { try { return byteRange(req.headers.range, size); } catch (e) { reply.header('Content-Range', `bytes */${size}`); throw e; } };
        const file = kind === 'content' ? await rt.ajax.getContentFile(matching(p.contentId, ctx.grant.content), p['*'], rt.user, req.headers.range ? (size) => range(size)! : undefined) : await rt.ajax.getTemporaryFile(p['*'], rt.user, req.headers.range ? (size) => range(size)! : undefined);
        reply.type(file.mimetype).header('Accept-Ranges', 'bytes');
        if (file.range) reply.code(206).header('Content-Range', `bytes ${file.range.start}-${file.range.end}/${file.stats.size}`).header('Content-Length', file.range.end - file.range.start + 1);
        else reply.header('Content-Length', file.stats.size);
        return reply.send(file.stream);
      });
    }
    native.get('/:grant/download/:contentId', async (req, reply) => {
      const ctx = await context(req), target = matching((req.params as any).contentId, ctx.grant.content);
      return reply.type('application/zip').header('Content-Disposition', `attachment; filename="activity.h5p"`).send(await exportContent(ctx.scope, target));
    });
    for (const method of ['GET', 'POST'] as const) {
      native.route({ method, url: '/:grant/contentUserData/:contentId/:dataType/:subContentId', bodyLimit: 1100 * 1024,
        handler: async (req) => {
          const ctx = await context(req), p = req.params as any;
          if (ctx.grant.mode !== 'play' || (req.query as any).asUserId) throw new StudioError(403, 'Learner state is private to published playback.');
          const target = matching(p.contentId, ctx.grant.content);
          const dataType = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/).parse(p.dataType), sub = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/).parse(p.subContentId);
          const rt = await runtime(ctx.scope, ctx.base), manager = rt.editor.contentUserDataManager!;
          if (method === 'GET') { const state = await manager.getContentUserData(target, dataType, sub, rt.user); return { success: true, data: state?.userState ?? false }; }
          const body = z.object({ data: z.union([z.string().max(1048576), z.literal(0)]), invalidate: z.coerce.number().int().min(0).max(1), preload: z.coerce.number().int().min(0).max(1) }).parse(req.body);
          await manager.createOrUpdateContentUserData(target, dataType, sub, String(body.data), !!body.invalidate, !!body.preload, rt.user);
          return { success: true };
        } });
    }
    native.post('/:grant/finishedData', async (req) => {
      const ctx = await context(req);
      if (ctx.grant.mode !== 'play') throw new StudioError(403, 'Preview results are not recorded.');
      const body = finishedSchema.parse(req.body);
      matching(body.contentId, ctx.grant.content);
      const rt = await runtime(ctx.scope, ctx.base);
      await rt.editor.contentUserDataManager!.setFinished(body.contentId, body.score, body.maxScore, body.opened, body.finished, body.time ?? Math.min(31_536_000, body.finished - body.opened), rt.user);
      return { success: true, authoritative: false };
    });
  }, { prefix: '/h5p/runtime', logLevel: 'silent' });
}
