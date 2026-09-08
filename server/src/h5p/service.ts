import type { PoolClient } from 'pg';
import type { IContentMetadata } from '@lumieducation/h5p-server';
import { z } from 'zod';
import { one, q, pool } from '../db.js';
import { getRole, type Role } from '../lib/http.js';
import type { JwtUser } from '../lib/tokens.js';
import { recordActivity } from '../team/activity.js';
import { getSurfaces } from '../surfaces.js';
import { StudioError, placementTargets, prepareImport, saveSchema, type Grant, type Placement } from './domain.js';
import { exportContent, forkContent, removeContent, runtime, type RuntimeScope } from './runtime.js';

export interface ActivityRow {
  id: string; space_id: string; title: string; draft_revision: number; published_revision: number | null;
  access_epoch: number; archived: boolean; source_deck_id: string | null; updated_at: string;
  role: Role; draft_library?: string; published_library?: string; published_title?: string;
}
export interface Revision { revision: number; content_id: string; library: string; title: string; published_at: string | null }
export async function spaceRole(spaceId: string, userId: string, min: Role = 'viewer'): Promise<Role> {
  z.string().uuid().parse(spaceId);
  const role = await getRole(userId, spaceId);
  if (!role) throw new StudioError(404, 'Workspace not found.');
  if ((min === 'editor' && role === 'viewer') || (min === 'owner' && role !== 'owner')) throw new StudioError(403, `Requires ${min} access.`);
  return role;
}
const joinedActivity = `SELECT a.*, m.role, d.library AS draft_library, p.library AS published_library, p.title AS published_title
  FROM h5p_activities a JOIN memberships m ON m.space_id=a.space_id AND m.user_id=$2
  LEFT JOIN h5p_revisions d ON d.activity_id=a.id AND d.revision=a.draft_revision
  LEFT JOIN h5p_revisions p ON p.activity_id=a.id AND p.revision=a.published_revision`;
export async function activityFor(id: string, userId: string): Promise<ActivityRow> {
  z.string().uuid().parse(id);
  const row = await one<ActivityRow>(`${joinedActivity} WHERE a.id=$1`, [id, userId]);
  if (!row || (row.role === 'viewer' && (row.archived || !row.published_revision))) throw new StudioError(404, 'Activity not found.');
  return row;
}
export function summary(row: ActivityRow) {
  const author = row.role !== 'viewer';
  return {
    id: row.id, spaceId: row.space_id, title: author ? row.title : row.published_title,
    library: author ? row.draft_library ?? null : row.published_library ?? null,
    draftRevision: author ? row.draft_revision : row.published_revision,
    publishedRevision: row.published_revision, hasUnpublishedChanges: author && row.draft_revision !== row.published_revision,
    archived: row.archived, canEdit: author, updatedAt: row.updated_at,
    ...(author ? { sourceDeckId: row.source_deck_id } : {}),
  };
}
export async function revisionFor(activityId: string, revision: number): Promise<Revision> {
  const row = await one<Revision>('SELECT revision,content_id,library,title,published_at FROM h5p_revisions WHERE activity_id=$1 AND revision=$2', [activityId, revision]);
  if (!row) throw new StudioError(404, 'Activity revision not found.');
  return row;
}
export async function assertPlacement(spaceId: string, placement: Placement): Promise<void> {
  if (placement.kind === 'path' && !(await getSurfaces(spaceId)).paths) throw new StudioError(403, 'Enable Learning Paths in workspace settings first.');
  const target = placementTargets[placement.kind];
  if (!(await one(`SELECT id FROM ${target.table} WHERE id=$1 AND space_id=$2`, [placement.id, spaceId]))) throw new StudioError(404, 'The destination is not in this workspace.');
}
export async function listActivities(spaceId: string, userId: string, options: { placement?: Placement; search?: string; offset?: number; archived?: boolean; status?: string } = {}) {
  const role = await spaceRole(spaceId, userId);
  if (options.placement) await assertPlacement(spaceId, options.placement);
  const filter = options.placement ? `AND EXISTS (SELECT 1 FROM h5p_placements x WHERE x.activity_id=a.id AND x.${placementTargets[options.placement.kind].column}=$7)` : '';
  const rows = await q<ActivityRow & { total: number }>(`${joinedActivity.replace('SELECT a.*', 'SELECT count(*) OVER()::int AS total, a.*')}
    WHERE a.space_id=$1 AND a.archived=$3 AND (m.role<>'viewer' OR a.published_revision IS NOT NULL)
    AND (CASE WHEN m.role='viewer' THEN p.title ELSE a.title END ILIKE $4)
    AND ($6='all' OR ($6='published' AND a.published_revision IS NOT NULL) OR ($6='draft' AND a.draft_revision IS DISTINCT FROM a.published_revision))
    ${filter} ORDER BY a.updated_at DESC,a.id LIMIT 40 OFFSET $5`,
  [spaceId, userId, role !== 'viewer' && !!options.archived, `%${options.search ?? ''}%`, options.offset ?? 0, options.status ?? 'all', ...(options.placement ? [options.placement.id] : [])]);
  return { activities: rows.map(summary), total: rows[0]?.total ?? 0, canEdit: role !== 'viewer', canInstall: role === 'owner' };
}
export async function createActivity(spaceId: string, user: JwtUser, title: string, placement?: Placement, sourceDeckId?: string) {
  await spaceRole(spaceId, user.id, 'editor');
  if (placement) await assertPlacement(spaceId, placement);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query<ActivityRow>('INSERT INTO h5p_activities (space_id,title,created_by,source_deck_id) VALUES ($1,$2,$3,$4) RETURNING *', [spaceId, title, user.id, sourceDeckId ?? null])).rows[0];
    if (placement) await client.query(`INSERT INTO h5p_placements (activity_id,space_id,${placementTargets[placement.kind].column}) VALUES ($1,$2,$3)`, [row.id, spaceId, placement.id]);
    await client.query('COMMIT');
    return summary(await activityFor(row.id, user.id));
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
async function editLocked<T>(id: string, user: JwtUser, operation: (row: ActivityRow, client: PoolClient) => Promise<T>, allowArchived = false): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query<ActivityRow>(`SELECT a.*,m.role FROM h5p_activities a JOIN memberships m ON m.space_id=a.space_id AND m.user_id=$2 WHERE a.id=$1 FOR UPDATE OF a`, [id, user.id])).rows[0];
    if (!row) throw new StudioError(404, 'Activity not found.');
    if (row.role === 'viewer') throw new StudioError(403, 'Requires editor access.');
    if (row.archived && !allowArchived) throw new StudioError(409, 'Restore this archived activity before editing.');
    const result = await operation(row, client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
function expectRevision(row: ActivityRow, expected: number) {
  if (row.draft_revision !== expected) throw new StudioError(409, 'Another editor saved a newer revision. Reopen the activity before applying your changes.');
}
export async function saveActivity(id: string, user: JwtUser, expected: number, input: z.infer<typeof saveSchema>, seed?: string) {
  let allocated: { space: string; id: string } | undefined;
  try {
    await editLocked(id, user, async (row, client) => {
      expectRevision(row, expected);
      const source = seed ?? (row.draft_revision ? (await revisionFor(id, row.draft_revision)).content_id : null);
      const target = await forkContent(row.space_id, source);
      allocated = { space: row.space_id, id: target };
      const rt = await runtime({ spaceId: row.space_id, user, role: row.role, mode: 'edit', readable: source ? [source, target] : [target], writable: [target], allocate: target });
      const saved = await rt.editor.saveOrUpdateContent(source ? target : undefined!, input.params.params, input.params.metadata as unknown as IContentMetadata, input.library, rt.user);
      if (saved !== target) throw new StudioError(500, 'The H5P revision could not be verified.');
      await client.query(`INSERT INTO h5p_revisions (activity_id,revision,content_id,title,library,created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [id, expected + 1, target, input.params.metadata.title, input.library, user.id]);
      await client.query('UPDATE h5p_activities SET title=$2,draft_revision=$3,updated_at=now() WHERE id=$1', [id, input.params.metadata.title, expected + 1]);
    });
  } catch (error) { if (allocated) await removeContent(allocated.space, allocated.id).catch(() => {}); throw error; }
  const row = await activityFor(id, user.id);
  void recordActivity(row.space_id, user.id, 'h5p_saved', { activityId: id, revision: row.draft_revision });
  return summary(row);
}
export async function publishActivity(id: string, user: JwtUser, expected: number, publish = true) {
  await editLocked(id, user, async (row, client) => {
    expectRevision(row, expected);
    if (publish && !row.draft_revision) throw new StudioError(409, 'Save the native H5P editor before publishing.');
    if (publish) await client.query('UPDATE h5p_revisions SET published_at=COALESCE(published_at,now()) WHERE activity_id=$1 AND revision=$2', [id, row.draft_revision]);
    await client.query('UPDATE h5p_activities SET published_revision=$2,access_epoch=access_epoch+$3,updated_at=now() WHERE id=$1', [id, publish ? row.draft_revision : null, publish ? 0 : 1]);
  });
  const row = await activityFor(id, user.id);
  void recordActivity(row.space_id, user.id, publish ? 'h5p_published' : 'h5p_unpublished', { activityId: id, revision: expected });
  return summary(row);
}
export async function archiveActivity(id: string, user: JwtUser, archived: boolean) {
  await editLocked(id, user, async (_row, client) => {
    await client.query('UPDATE h5p_activities SET archived=$2,access_epoch=access_epoch+1,updated_at=now() WHERE id=$1', [id, archived]);
  }, true);
  const row = await activityFor(id, user.id);
  void recordActivity(row.space_id, user.id, archived ? 'h5p_archived' : 'h5p_restored', { activityId: id });
  return summary(row);
}
export async function attachActivity(id: string, user: JwtUser, placement: Placement, remove = false) {
  const row = await activityFor(id, user.id);
  if (row.role === 'viewer') throw new StudioError(403, 'Requires editor access.');
  await assertPlacement(row.space_id, placement);
  const column = placementTargets[placement.kind].column;
  if (remove) await q(`DELETE FROM h5p_placements WHERE activity_id=$1 AND ${column}=$2`, [id, placement.id]);
  else await q(`INSERT INTO h5p_placements (activity_id,space_id,${column}) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [id, row.space_id, placement.id]);
  return { ok: true };
}
export async function exportActivity(id: string, user: JwtUser) {
  const row = await activityFor(id, user.id);
  if (row.archived) throw new StudioError(409, 'Restore this activity before exporting.');
  const revision = await revisionFor(id, row.role === 'viewer' ? row.published_revision! : row.draft_revision);
  return { data: await exportContent({ spaceId: row.space_id, user, role: row.role, mode: row.role === 'viewer' ? 'play' : 'preview', readable: [revision.content_id] }, revision.content_id), title: revision.title };
}
export async function importActivity(spaceId: string, user: JwtUser, buffer: Buffer, placement?: Placement) {
  const role = await spaceRole(spaceId, user.id, 'editor');
  if (placement) await assertPlacement(spaceId, placement);
  const prepared = prepareImport(buffer);
  const rt = await runtime({ spaceId, user, role, mode: 'edit', readable: [] });
  const missing = await rt.editor.libraryManager.getNotInstalledLibraries(prepared.dependencies);
  if (missing.length) throw new StudioError(422, `Install the matching content libraries first: ${missing.slice(0, 12).map((l) => `${l.machineName} ${l.majorVersion}.${l.minorVersion}`).join(', ')}. Uploaded library code is never installed.`);
  const imported = await rt.editor.uploadPackage(prepared.data, rt.user);
  if (!imported.metadata || !imported.parameters) throw new StudioError(422, 'The package contains no editable activity.');
  const main = imported.metadata.preloadedDependencies?.find((l) => l.machineName === imported.metadata!.mainLibrary);
  if (!main) throw new StudioError(422, 'The main content library is missing.');
  const activity = await createActivity(spaceId, user, prepared.title, placement);
  try {
    return await saveActivity(activity.id, user, 0, saveSchema.parse({ library: `${main.machineName} ${main.majorVersion}.${main.minorVersion}`, params: { metadata: imported.metadata, params: imported.parameters } }));
  } catch (error) { await q('DELETE FROM h5p_activities WHERE id=$1 AND draft_revision=0', [activity.id]); throw error; }
}
export async function copyRevision(id: string, user: JwtUser, revisionNumber: number, expected: number, duplicate: boolean) {
  const source = await activityFor(id, user.id);
  if (source.role === 'viewer') throw new StudioError(403, 'Requires editor access.');
  const revision = await revisionFor(id, revisionNumber);
  const rt = await runtime({ spaceId: source.space_id, user, role: source.role, mode: 'edit', readable: [revision.content_id] });
  const payload = await rt.editor.getContent(revision.content_id, rt.user);
  const target = duplicate ? await createActivity(source.space_id, user, `${revision.title.slice(0, 248)} (copy)`) : { id };
  try {
    return await saveActivity(target.id, user, duplicate ? 0 : expected, saveSchema.parse({ library: revision.library, params: { metadata: { ...payload.h5p, title: duplicate ? `${revision.title.slice(0, 248)} (copy)` : revision.title }, params: payload.params.params } }), revision.content_id);
  } catch (error) { if (duplicate) await q('DELETE FROM h5p_activities WHERE id=$1 AND draft_revision=0', [target.id]); throw error; }
}

/** Re-check live membership/publication for every runtime request, not only the initial launch. */
export async function authorizeGrant(grant: Grant): Promise<{ row: ActivityRow; user: JwtUser; scope: RuntimeScope }> {
  const row = await activityFor(grant.activity, grant.sub);
  if (row.space_id !== grant.space || row.archived || row.access_epoch !== grant.epoch) throw new StudioError(403, 'This activity is no longer available.');
  if (grant.mode !== 'play' && row.role === 'viewer') throw new StudioError(403, 'Authoring access was removed.');
  if (grant.mode === 'play' && !row.published_revision) throw new StudioError(403, 'This activity is no longer published.');
  if (grant.content) {
    const revision = await revisionFor(row.id, grant.revision);
    if (revision.content_id !== grant.content || (grant.mode === 'play' && !revision.published_at)) throw new StudioError(403, 'This revision is not available.');
  } else if (grant.mode !== 'edit' || grant.revision !== 0) throw new StudioError(403, 'Invalid activity launch.');
  const user = await one<JwtUser>('SELECT id,name,email FROM users WHERE id=$1', [grant.sub]);
  if (!user) throw new StudioError(401, 'User not found.');
  return { row, user, scope: { spaceId: row.space_id, user, role: row.role, mode: grant.mode, readable: grant.content ? [grant.content] : [] } };
}
