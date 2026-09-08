/** Integration contract: run against the seeded disposable CI database, never production. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { q, one, pool } from './dist/db.js';
import { config } from './dist/config.js';
import { signToken } from './dist/lib/tokens.js';
import { H5P_TOOLS } from './dist/h5p/tools.js';
const base = process.env.SET_BASE ?? 'http://localhost:4000/api';
const origin = new URL(base).origin;
if (process.env.H5P_TEST_DATABASE !== '1') throw new Error('Set H5P_TEST_DATABASE=1 only for a disposable seeded test database.');
let token = '', checks = 0;
async function call(method, path, body, auth = token) {
  const response = await fetch(path.startsWith('/api/') ? origin + path : base + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${auth}`, origin: 'http://localhost:5173' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: response.status, json };
}
function check(name, condition, detail) { assert.ok(condition, `${name}: ${JSON.stringify(detail ?? '')}`); checks++; console.log(`PASS ${name}`); }
const testSpace = randomUUID(), otherSpace = randomUUID(), viewerId = randomUUID(), editorId = randomUUID();
const libraries = join(config.dataDir, 'h5p', 'libraries', 'H5P.StudioSmoke-1.0');
const ids = [];
try {
  const login = await call('POST', '/auth/login', { email: 'demo@set.local', password: 'demo-demo' });
  token = login.json.token; const owner = login.json.user;
  check('demo authentication', !!token, login);
  await q("INSERT INTO spaces (id,name,owner_id) VALUES ($1,'H5P integration test',$2),($3,'H5P other workspace',$2)", [testSpace, owner.id, otherSpace]);
  await q("INSERT INTO memberships (space_id,user_id,role) VALUES ($1,$2,'owner'),($3,$2,'owner')", [testSpace, owner.id, otherSpace]);
  for (const [id, role] of [[viewerId, 'viewer'], [editorId, 'editor']]) {
    await q('INSERT INTO users (id,name,email,password_hash) VALUES ($1,$2,$3,$4)', [id, `H5P ${role}`, `${id}@example.invalid`, 'not-a-login-hash']);
    await q('INSERT INTO memberships (space_id,user_id,role) VALUES ($1,$2,$3)', [testSpace, id, role]);
  }
  const viewer = signToken({ id: viewerId, name: 'Viewer', email: 'viewer@example.invalid' });
  const editor = signToken({ id: editorId, name: 'Editor', email: 'editor@example.invalid' });
  await mkdir(libraries, { recursive: true });
  await writeFile(join(libraries, 'library.json'), JSON.stringify({ title: 'Studio integration fixture', machineName: 'H5P.StudioSmoke', majorVersion: 1, minorVersion: 0, patchVersion: 0, runnable: 1, embedTypes: ['div'], preloadedJs: [{ path: 'fixture.js' }], license: 'MIT' }));
  await writeFile(join(libraries, 'semantics.json'), JSON.stringify([{ name: 'text', type: 'text', label: 'Content', optional: false }]));
  await writeFile(join(libraries, 'fixture.js'), 'H5P.StudioSmoke=function(p){this.attach=function(c){c.text(p.text)}};');
  const status = await call('GET', `/spaces/${testSpace}/h5p/status`);
  check('pinned browser runtime is installed', status.status === 200 && status.json.ready, status);
  check('unauthenticated management is denied', (await call('GET', `/spaces/${testSpace}/h5p/activities`, undefined, '')).status === 401);
  check('viewer cannot create', (await call('POST', `/spaces/${testSpace}/h5p/activities`, {}, viewer)).status === 403);
  check('editor cannot install library code', (await call('POST', `/spaces/${testSpace}/h5p/libraries`, { machineName: 'H5P.AdvancedText' }, editor)).status === 403);
  let result = await call('POST', `/spaces/${testSpace}/h5p/activities`, { title: 'Integration draft' });
  check('create a private activity', result.status === 200 && result.json.activity?.draftRevision === 0, result);
  const activity = result.json.activity; ids.push(activity.id);
  check('empty drafts cannot publish', (await call('POST', `/h5p/activities/${activity.id}/publish`, { expectedRevision: 0 })).status === 409);
  check('viewer cannot read draft', (await call('GET', `/h5p/activities/${activity.id}`, undefined, viewer)).status === 404);
  const launch = (await call('POST', `/h5p/activities/${activity.id}/launch`, { mode: 'edit' })).json;
  const runtime = launch.url.replace(/\/editor$/, '');
  const html = await call('GET', launch.url);
  check('native editor HTML renders', html.status === 200 && html.json.includes('H5PEditor.Editor'), html);
  const core = await fetch(origin + runtime + '/core/js/h5p.js');
  check('authenticated core asset delivery', core.status === 200 && core.headers.get('content-type')?.includes('javascript'));
  const body = { library: 'H5P.StudioSmoke 1.0', params: { metadata: { title: 'Published version', license: 'U' }, params: { text: 'Version one' } } };
  result = await call('POST', runtime + '/save', body);
  check('first native save allocates immutable revision', result.status === 200 && result.json.activity?.draftRevision === 1, result);
  check('stale editor saves are rejected', (await call('POST', runtime + '/save', body)).status === 409);
  result = await call('POST', `/h5p/activities/${activity.id}/publish`, { expectedRevision: 1 });
  check('publish saved revision', result.status === 200 && result.json.activity.publishedRevision === 1, result);
  const play = (await call('POST', `/h5p/activities/${activity.id}/launch`, { mode: 'play' }, viewer)).json;
  const playBase = play.url.replace(/\/play$/, '');
  const rev = await one('SELECT content_id FROM h5p_revisions WHERE activity_id=$1 AND revision=1', [activity.id]);
  check('published player renders for viewers', (await call('GET', play.url)).status === 200);
  check('viewer launch cannot save', (await call('POST', playBase + '/save', body)).status === 403);
  check('runtime cannot cross content ids', (await call('GET', playBase + '/content/9999999999999/content.json')).status === 403);
  const statePath = `${playBase}/contentUserData/${rev.content_id}/state/0`;
  check('save private resume state', (await call('POST', statePath, { data: '{"progress":1}', invalidate: 1, preload: 1 })).status === 200);
  check('resume state round-trips', (await call('GET', statePath)).json.data === '{"progress":1}');
  check('cannot impersonate another learner', (await call('GET', `${statePath}?asUserId=${owner.id}`)).status === 403);
  check('valid practice result is recorded', (await call('POST', playBase + '/finishedData', { contentId: rev.content_id, score: 1, maxScore: 2, opened: 10, finished: 20 })).status === 200);
  check('invalid practice result is rejected', (await call('POST', playBase + '/finishedData', { contentId: rev.content_id, score: 4, maxScore: 2, opened: 10, finished: 20 })).status === 422);
  const results = (await call('GET', `/h5p/activities/${activity.id}/results`, undefined, viewer)).json;
  check('practice is explicitly non-authoritative', results.authoritative === false && results.results.length === 1, results);
  const edit2 = (await call('POST', `/h5p/activities/${activity.id}/launch`, { mode: 'edit' })).json.url.replace(/\/editor$/, '');
  const changed = structuredClone(body); changed.params.metadata.title = 'Private second draft'; changed.params.params.text = 'Version two';
  check('editing creates a second revision', (await call('POST', edit2 + '/save', changed)).json.activity?.draftRevision === 2);
  check('viewer still sees published title', (await call('GET', `/h5p/activities/${activity.id}`, undefined, viewer)).json.activity.title === 'Published version');
  check('old player still serves immutable version', (await call('GET', play.url)).json.includes('Version one'));
  const response = await fetch(base + `/h5p/activities/${activity.id}/export`, { headers: { authorization: `Bearer ${token}` } });
  const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
  check('export contains real library code and parameters', !!zip.getEntry('H5P.StudioSmoke-1.0/fixture.js') && zip.readAsText('content/content.json').includes('Version two'));
  const form = new FormData(); form.append('files', new Blob([zip.toBuffer()]), 'roundtrip.h5p');
  const imported = await fetch(base + `/spaces/${testSpace}/h5p/import`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  const importedJson = await imported.json();
  check('exported package can be re-imported', imported.status === 200 && importedJson.activity?.draftRevision === 1, importedJson);
  ids.push(importedJson.activity.id);
  const page = (await q("INSERT INTO pages (space_id,title) VALUES ($1,'Placement test') RETURNING id", [testSpace]))[0];
  check('attach to a page', (await call('PUT', `/h5p/activities/${activity.id}/placements`, { kind: 'page', id: page.id })).status === 200);
  check('contextual library returns attached activity', (await call('GET', `/spaces/${testSpace}/h5p/activities?kind=page&parentId=${page.id}`)).json.activities.length === 1);
  const foreign = (await q("INSERT INTO pages (space_id,title) VALUES ($1,'Other workspace page') RETURNING id", [otherSpace]))[0];
  check('reject cross-workspace attachment', (await call('PUT', `/h5p/activities/${activity.id}/placements`, { kind: 'page', id: foreign.id })).status === 404);
  await assert.rejects(() => H5P_TOOLS.find((tool) => tool.name === 'h5p_publish_activity').run({ activityId: activity.id, expectedRevision: 2 }, { spaceId: otherSpace, userId: owner.id }));
  check('MCP/agent capability enforces connected workspace', true);
  const restored = await call('POST', `/h5p/activities/${activity.id}/restore`, { revision: 1, expectedRevision: 2 });
  check('restore creates a new draft revision', restored.json.activity?.draftRevision === 3, restored);
  check('unpublish succeeds', (await call('POST', `/h5p/activities/${activity.id}/unpublish`, { expectedRevision: 3 })).status === 200);
  check('unpublish revokes previous player grants', (await call('GET', play.url)).status === 404 || (await call('GET', play.url)).status === 403);
  check('archive succeeds', (await call('PATCH', `/h5p/activities/${activity.id}`, { archived: true })).json.activity?.archived === true);
  check('archived content is not launchable', (await call('POST', `/h5p/activities/${activity.id}/launch`, { mode: 'edit' })).status === 409);
  check('archive can be restored', (await call('PATCH', `/h5p/activities/${activity.id}`, { archived: false })).json.activity?.archived === false);
  console.log(`H5P integration: ${checks} checks passed`);
} finally {
  // Dedicated test spaces own all artifacts; don't mutate normal demo content.
  await q('DELETE FROM spaces WHERE id=ANY($1::uuid[])', [[testSpace, otherSpace]]);
  await q('DELETE FROM users WHERE id=ANY($1::uuid[])', [[viewerId, editorId]]);
  await rm(join(config.dataDir, 'h5p', 'spaces', testSpace), { recursive: true, force: true });
  await rm(libraries, { recursive: true, force: true });
  await pool.end();
}
