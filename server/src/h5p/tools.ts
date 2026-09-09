import { z } from 'zod';
import { one } from '../db.js';
import type { JwtUser } from '../lib/tokens.js';
import { libraryRef, placementSchema, saveSchema, StudioError } from './domain.js';
import { activityFor, attachActivity, createActivity, listActivities, publishActivity, saveActivity, spaceRole } from './service.js';
import { runtime } from './runtime.js';
import { libraryInventory, requireUsableLibrary } from './libraries.js';

/** One capability catalog, adapted into the existing copilot and MCP tool registries. */
export interface H5PTool {
  name: string; description: string; parameters: any; write: boolean;
  run: (args: any, ctx: { spaceId: string; userId: string }) => Promise<any>;
}
async function actor(ctx: { spaceId: string; userId: string }, activityId?: string) {
  await spaceRole(ctx.spaceId, ctx.userId);
  if (activityId && (await activityFor(activityId, ctx.userId)).space_id !== ctx.spaceId) throw new StudioError(404, 'Activity not found in the connected workspace.');
  const user = await one<JwtUser>('SELECT id,name,email FROM users WHERE id=$1', [ctx.userId]);
  if (!user) throw new StudioError(401, 'User not found.');
  return user;
}
const id = { type: 'string', format: 'uuid', description: 'Existing H5P activity UUID in the connected workspace' };
export const H5P_TOOLS: H5PTool[] = [
  {
    name: 'h5p_list_activities', description: 'Search reusable H5P activities in this workspace. Viewers see published activities only.', write: false,
    parameters: { type: 'object', properties: { search: { type: 'string' }, offset: { type: 'integer', minimum: 0 } } },
    async run(args, ctx) { const input = z.object({ search: z.string().max(100).optional(), offset: z.number().int().min(0).max(100000).optional() }).parse(args); return listActivities(ctx.spaceId, ctx.userId, input); },
  },
  {
    name: 'h5p_content_types', description: 'List verified, usable native H5P content types bundled with SET. No manual Hub installation is needed. Supply an exact library reference to inspect its authoring semantics before producing parameters. Never invent library versions.', write: false,
    parameters: { type: 'object', properties: { library: { type: 'object', properties: { machineName: { type: 'string' }, majorVersion: { type: 'integer' }, minorVersion: { type: 'integer' } }, required: ['machineName', 'majorVersion', 'minorVersion'] } } },
    async run(args, ctx) { const user = await actor(ctx); const role = await spaceRole(ctx.spaceId, ctx.userId); const rt = await runtime({ spaceId: ctx.spaceId, user, role, mode: 'preview', readable: [] }); const { library } = z.object({ library: libraryRef.optional() }).parse(args); if (library) { await requireUsableLibrary(rt.libraryStorage, library); return { library: await rt.libraryStorage.getLibrary(library), semantics: JSON.parse(await rt.libraryStorage.getFileAsString(library, 'semantics.json')) }; } const inventory = await libraryInventory(rt.libraryStorage); return { libraries: inventory.filter(l => l.runnable && l.usable), unavailable: inventory.filter(l => l.runnable && !l.usable), source: 'verified-local-libraries' }; },
  },
  {
    name: 'h5p_create_draft', description: 'Create a private H5P Studio draft. This does not publish or change an existing assessment. Open the returned Studio URL to author any installed content type.', write: true,
    parameters: { type: 'object', properties: { title: { type: 'string', maxLength: 255 } }, required: ['title'] },
    async run(args, ctx) { const { title } = z.object({ title: z.string().trim().min(1).max(255) }).parse(args); const activity = await createActivity(ctx.spaceId, await actor(ctx), title); return { activity, studioUrl: `/app/space/${ctx.spaceId}/h5p/${activity.id}` }; },
  },
  {
    name: 'h5p_save_draft', description: 'Save native H5P parameters as a NEW private revision. Inspect h5p_content_types semantics first; include metadata.title. expectedRevision prevents overwriting another author. Publishing requires a separate explicit action.', write: true,
    parameters: { type: 'object', properties: { activityId: id, expectedRevision: { type: 'integer', minimum: 0 }, library: { type: 'string', description: 'Exact installed ubername, e.g. H5P.AdvancedText 1.1' }, params: { type: 'object', properties: { metadata: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }, params: { type: 'object', description: 'Native content-type parameters matching installed semantics' } }, required: ['metadata', 'params'] } }, required: ['activityId', 'expectedRevision', 'library', 'params'] },
    async run(args, ctx) { const input = saveSchema.extend({ activityId: z.string().uuid(), expectedRevision: z.number().int().min(0) }).parse(args); return { activity: await saveActivity(input.activityId, await actor(ctx, input.activityId), input.expectedRevision, input) }; },
  },
  {
    name: 'h5p_attach_activity', description: 'Attach one reusable H5P activity to a page, notebook or enabled learning path in this workspace. Does not duplicate the activity or publish a draft.', write: true,
    parameters: { type: 'object', properties: { activityId: id, kind: { type: 'string', enum: ['page', 'notebook', 'path'] }, id: { type: 'string', format: 'uuid', description: 'Destination UUID' } }, required: ['activityId', 'kind', 'id'] },
    async run(args, ctx) { const input = placementSchema.extend({ activityId: z.string().uuid() }).parse(args); return attachActivity(input.activityId, await actor(ctx, input.activityId), input); },
  },
  {
    name: 'h5p_publish_activity', description: 'Publish the saved H5P draft across its workspace placements. Call only when the user explicitly requests publication after review. Client practice scores never become assessed grades.', write: true,
    parameters: { type: 'object', properties: { activityId: id, expectedRevision: { type: 'integer', minimum: 1 } }, required: ['activityId', 'expectedRevision'] },
    async run(args, ctx) { const input = z.object({ activityId: z.string().uuid(), expectedRevision: z.number().int().positive() }).parse(args); return { activity: await publishActivity(input.activityId, await actor(ctx, input.activityId), input.expectedRevision) }; },
  },
];
