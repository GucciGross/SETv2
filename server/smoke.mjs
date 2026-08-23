const BASE = 'http://localhost:4000/api';
let token = '';
const h = () => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const call = async (method, path, body) => {
  const res = await fetch(BASE + path, { method, headers: h(), body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
};
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗ FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};

// 1. login with demo
let r = await call('POST', '/auth/login', { email: 'demo@set.local', password: 'demo-demo' });
check('login demo user', r.status === 200 && r.json.token);
token = r.json.token;
const user = r.json.user;
const spaces = (await call('GET', '/spaces')).json.spaces;
check('spaces list', spaces.length >= 1, spaces.map(s => s.name).join(', '));
const team = spaces.find(s => s.name === 'Robotics Lab');
check('demo team space exists', !!team);

// 2. pages + tree
const pages = (await call('GET', `/spaces/${team.id}/pages`)).json.pages;
check('demo pages seeded', pages.length >= 7, `${pages.length} pages`);
const home = pages.find(p => p.title === 'Robotics Lab Home');
const actuator = pages.find(p => p.title === 'Actuator Selection Guide');
check('home + actuator pages', !!home && !!actuator);

// 3. backlinks via wiki links
const bl = (await call('GET', `/pages/${actuator.id}/backlinks`)).json;
check('backlinks resolved', bl.backlinks.length >= 1 && bl.outgoing.length >= 1, `back=${bl.backlinks.length} out=${bl.outgoing.length}`);

// 4. unlinked mentions
const mentionTarget = pages.find(p => p.title === 'Control Theory Notes');
const mentions = (await call('GET', `/pages/${mentionTarget.id}/mentions`)).json.mentions;
check('mentions endpoint works', Array.isArray(mentions), `${mentions.length} mentions`);

// 5. page CRUD + markdown round trip
const created = (await call('POST', '/pages', { spaceId: team.id, title: 'Smoke Test Page', markdown: '# Hello\n\nLink to [[Actuator Selection Guide]] and [[New Uncreated Page]]' })).json.page;
check('create page', !!created?.id);
const fetched = (await call('GET', `/pages/${created.id}`)).json.page;
check('markdown stored + content converted to TipTap doc', fetched.markdown.includes('# Hello') && fetched.content?.content?.length > 0);
const bl2 = (await call('GET', `/pages/${actuator.id}/backlinks`)).json;
check('new backlink created automatically', bl2.backlinks.some(b => b.id === created.id));
const patched = (await call('PATCH', `/pages/${created.id}`, { markdown: '# Updated\n\nstill linking [[Actuator Selection Guide]]' })).json.page;
check('patch page markdown', patched.markdown.includes('Updated'));

// 5b. rich markdown round-trip: table + image + strike + highlight + blockRef
const richMd = '# Rich\n\n| A | B |\n| :--- | ---: |\n| 1 | 2 |\n\n![pic](/api/files/demo.png) ~~x~~ ==y==\n\n((9b41c2d0-1111-2222-3333-444455556666))';
const richPage = (await call('POST', '/pages', { spaceId: team.id, title: 'Rich MD Test', markdown: richMd })).json.page;
const richFetched = (await call('GET', `/pages/${richPage.id}`)).json.page;
const richJson = JSON.stringify(richFetched.content);
check('rich md: table node', richJson.includes('"table"') && richJson.includes('"tableHeader"'));
check('rich md: image node', richJson.includes('"image"'));
check('rich md: strike+highlight marks', richJson.includes('"strike"') && richJson.includes('"highlight"'));
check('rich md: blockRef node', richJson.includes('"blockRef"'));
const richSaved = richFetched.markdown;
check('rich md: serialized back to pipes', richSaved.includes('| A | B |') && richSaved.includes(':---'));
await call('DELETE', `/pages/${richPage.id}`);

// 5c. file upload + serve (multipart)
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const pngBuffer = Buffer.from(pngBase64, 'base64');
const fd = new FormData();
fd.append('files', new Blob([pngBuffer], { type: 'image/png' }), 'dot.png');
const up = await fetch(`${BASE}/spaces/${team.id}/files`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
  body: fd,
});
const upJson = await up.json();
check('file upload', up.status === 200 && upJson.files?.length === 1);
const fileId = upJson.files?.[0]?.id;
const served = await fetch(`${BASE}/files/${fileId}`);
const servedBuf = Buffer.from(await served.arrayBuffer());
check('file served back intact', served.status === 200 && servedBuf.equals(pngBuffer) && served.headers.get('content-type') === 'image/png');

await call('DELETE', `/pages/${created.id}`);
const trash = (await call('GET', `/spaces/${team.id}/trash`)).json.pages;
check('soft delete → trash', trash.some(t => t.id === created.id));

// 6. daily note
const dailyResp = await call('POST', `/spaces/${team.id}/daily`);
const daily = dailyResp.json.page;
check('daily note get-or-create', daily?.is_daily === true, JSON.stringify(dailyResp.json).slice(0, 120));

// 7. graph
const graph = (await call('GET', `/spaces/${team.id}/graph`)).json;
check('graph nodes+edges', graph.nodes.length >= 7 && graph.edges.length >= 3, `${graph.nodes.length}n/${graph.edges.length}e`);

// 8. databases
const dbs = (await call('GET', `/spaces/${team.id}/databases`)).json.databases;
check('demo database exists', dbs.length >= 1);
const dbFull = (await call('GET', `/databases/${dbs[0].id}`)).json;
check('database views (table/kanban/calendar/gallery)', dbFull.views.length === 4, dbFull.views.map(v => v.type).join('/'));
check('database rows seeded', dbFull.rows.length === 3);
const newRow = (await call('POST', `/databases/${dbs[0].id}/rows`, { cells: { c2: 'Planned' }, createPage: true })).json.row;
check('create row with page', !!newRow.id && !!newRow.page_id);
await call('PATCH', `/rows/${newRow.id}`, { cells: { c2: 'Running' } });
const dbAfter = (await call('GET', `/databases/${dbs[0].id}`)).json;
check('row cell update', dbAfter.rows.find(x => x.id === newRow.id).cells.c2 === 'Running');
await call('DELETE', `/rows/${newRow.id}`);

// 9. notebooks + RAG (hash embeddings, no LLM)
const nbs = (await call('GET', `/spaces/${team.id}/notebooks`)).json.notebooks;
check('demo notebook exists', nbs.length === 1 && nbs[0].chunk_count >= 4, `${nbs[0]?.chunk_count} chunks`);
const nbDetail = (await call('GET', `/notebooks/${nbs[0].id}`)).json;
check('source ready after ingestion', nbDetail.sources[0].status === 'ready', nbDetail.sources[0].status);
const srcId = nbDetail.sources[0].id;
const chunks = (await call('GET', `/sources/${srcId}/chunks`)).json.chunks;
check('chunks listed', chunks.length >= 4);
const search = (await call('POST', `/notebooks/${nbs[0].id}/search`, { query: 'what torque requirements for actuator selection' })).json;
check('hybrid search returns hits', search.hits.length >= 2, search.hits.slice(0, 2).map(h => h.heading || h.content.slice(0, 30)).join(' | '));

// add a web/text source
const addSrc = await call('POST', `/notebooks/${nbs[0].id}/sources`, { text: '# Extra Notes\n\nEtherCAT bus latency is under 100 microseconds in practice.\n\n## Safety interlocks\n\nCategory 0 stop removes power immediately.', name: 'Pasted Notes' });
check('add pasted text source', addSrc.status === 200);
await new Promise(r2 => setTimeout(r2, 1500));
const nb2 = (await call('GET', `/notebooks/${nbs[0].id}`)).json;
const pasted = nb2.sources.find(s => s.name === 'Pasted Notes');
check('pasted source ingested', pasted?.status === 'ready', pasted?.status ?? 'missing');
const chunks2 = (await call('GET', `/sources/${pasted.id}/chunks`)).json.chunks;
check('chunk edit (human-in-loop)', (await call('PATCH', `/chunks/${chunks2[0].id}`, { content: chunks2[0].content + ' [edited]' })).status === 200);
const views = (await call('GET', `/notebooks/${nbs[0].id}/views`)).json;
check('knowledge views compiled', views.tree.length >= 2 && views.timeline.length >= 3, `tree=${views.tree.length} timeline=${views.timeline.length}`);

// 10. grounded chat SSE (no provider configured → graceful notice)
const chatRes = await fetch(`${BASE}/spaces/${team.id}/chat`, { method: 'POST', headers: h(), body: JSON.stringify({ notebookId: nbs[0].id, message: 'What are the actuator types?' }) });
const chatText = await chatRes.text();
check('grounded chat SSE responds', chatRes.ok && chatText.includes('event: done') && chatText.includes('LLM provider'), chatText.split('\n')[0]);

// 11. agent run SSE (no provider → graceful notice + events)
const agentRes = await fetch(`${BASE}/agent/run`, { method: 'POST', headers: h(), body: JSON.stringify({ spaceId: team.id, message: 'summarize the workspace' }) });
const agentText = await agentRes.text();
check('agent SSE lifecycle', agentText.includes('RUN_STARTED') && agentText.includes('RUN_FINISHED') && agentText.includes('TEXT_MESSAGE_CONTENT'));

// 12. study materials (requires provider → expect graceful 502)
const studyRes = await call('POST', `/notebooks/${nbs[0].id}/generate`, { kind: 'flashcards' });
check('study generation reports missing LLM gracefully', studyRes.status === 502 && /provider/i.test(studyRes.json.error ?? ''));

// 13. 3D models
const models = (await call('GET', `/spaces/${team.id}/models`)).json.models;
check('demo URDF model exists', models.length === 1 && models[0].kind === 'urdf');
const modelDetail = (await call('GET', `/models/${models[0].id}`)).json.model;
check('URDF parsed to links+joints', modelDetail.parts.links.length === 6 && modelDetail.parts.joints.length === 5, `${modelDetail.parts.links.length}L/${modelDetail.parts.joints.length}J`);
const autolink = (await call('POST', `/models/${models[0].id}/autolink`)).json;
check('autolink parts to pages', (autolink.linked ?? 0) >= 1, `linked ${autolink.linked ?? 0} parts`);
const fileRes = await fetch(BASE + '/models/' + models[0].id + '/file', { headers: h() });
check('model file streams', fileRes.status === 200 && (await fileRes.text()).includes('<robot'));

// 14. learning paths
const paths = (await call('GET', '/spaces/' + team.id + '/paths')).json.paths;
check('learning path seeded', paths.length === 1 && Number(paths[0].item_count) === 4);
const prog = await call('POST', '/paths/' + paths[0].id + '/progress', { itemIndex: 0, done: true });
check('path progress toggle', prog.status === 200);

// 15. search + export
const search2 = (await call('GET', '/spaces/' + team.id + '/search?q=actuator')).json;
check('workspace search', search2.pages.length >= 1);
const exportMd = await fetch(BASE + '/pages/' + home.id + '/export.md', { headers: h() });
check('page markdown export', exportMd.status === 200 && (await exportMd.text()).includes('Robotics Lab'));

// 16. providers management
const presets = (await call('GET', '/providers/presets')).json.presets;
check('provider presets', presets.length >= 5);
const createdProv = await call('POST', '/spaces/' + team.id + '/providers', { name: 'Test Ollama', baseUrl: 'http://localhost:11434/v1', chatModel: 'llama3.1' });
check('create provider', createdProv.status === 200);

// 17. auth: register new user + invite + permission enforcement
const reg = await call('POST', '/auth/register', { email: 'smoke@test.local', name: 'Smoke', password: 'password123' });
check('register new user', reg.status === 200 && reg.json.token);
const invite = await call('POST', '/spaces/' + team.id + '/invite', { email: 'smoke@test.local', role: 'viewer' });
check('invite member', invite.status === 200);
token = reg.json.token;
const memberView = await call('GET', '/spaces/' + team.id + '/pages');
check('invited viewer can read', memberView.status === 200);
const memberWrite = await call('POST', '/pages', { spaceId: team.id, title: 'nope' });
check('viewer cannot write (403)', memberWrite.status === 403);

// 18. settings (re-login as space owner — current token is the invited viewer)
const relogin = await call('POST', '/auth/login', { email: 'demo@set.local', password: 'demo-demo' });
token = relogin.json.token;
const settings = await call('PATCH', '/spaces/' + team.id + '/settings', { settings: { agentApprovals: true } });
check('workspace settings update', settings.status === 200);


// 19. work surfaces: demo space has all enabled
const settingsNow = (await call('GET', `/spaces/${team.id}/settings`)).json.settings;
check('demo space surfaces all on', settingsNow.surfaces?.threeD === true && settingsNow.surfaces.library === true);

// 20. coding surface: file CRUD + sandbox run
const put1 = await call('PUT', `/spaces/${team.id}/code/file`, { path: 'notes/solver.js', content: 'const fib = (n) => n < 2 ? n : fib(n-1) + fib(n-2); console.log("fib(10)=", fib(10)); fib(10)' });
check('code file save', put1.status === 200);
const fileList = (await call('GET', `/spaces/${team.id}/code/files`)).json.files;
check('code file listed', fileList.some((f) => f.path === 'notes/solver.js'));
const run = await call('POST', `/spaces/${team.id}/code/run`, { code: '1 + 41' });
check('sandbox run returns 42', run.json.ok === true && run.json.result === '42', JSON.stringify(run.json).slice(0, 80));
const runPath = await call('POST', `/spaces/${team.id}/code/run`, { path: 'notes/solver.js' });
check('sandbox run from file + logs', runPath.json.ok === true && runPath.json.logs.some((l) => l.includes('fib(10)= 55')), JSON.stringify(runPath.json).slice(0, 120));
const runBad = await call('POST', `/spaces/${team.id}/code/run`, { code: 'while(true){}' });
check('sandbox timeout enforced', runBad.json.ok === false, JSON.stringify(runBad.json).slice(0, 80));
const del1 = await call('DELETE', `/spaces/${team.id}/code/file?path=${encodeURIComponent('notes/solver.js')}`);
check('code file delete', del1.status === 200);

// 21. terminal surface
const th = (await call('POST', '/terminal/exec', { spaceId: team.id, command: 'help' })).json.output;
check('terminal help', th.includes('pages') && th.includes('find'));
const tp = (await call('POST', '/terminal/exec', { spaceId: team.id, command: 'pages actuator' })).json.output;
check('terminal pages filter', tp.toLowerCase().includes('actuator selection guide'));
const tf = (await call('POST', '/terminal/exec', { spaceId: team.id, command: 'find actuator torque' })).json.output;
check('terminal grounded find', tf.length > 20, tf.slice(0, 80));
const tj = (await call('POST', '/terminal/exec', { spaceId: team.id, command: 'runjs 6*7' })).json.output;
check('terminal runjs', tj.includes('42'));

// 22. library: catalog + HF browse (network-tolerant) + surface gating
const cat = (await call('GET', '/library/catalog')).json.catalog;
check('library catalog has CAD dataset', cat.some((c) => c.id === 'markov-ai/cad-1000-hours'));
let browseOk = false, browseNote = '';
try {
  const br = await call('GET', `/library/datasets/${encodeURIComponent('markov-ai/cad-1000-hours')}/browse?spaceId=${team.id}&path=`);
  browseOk = br.status === 200 && br.json.entries?.length > 0;
  browseNote = `${br.json.entries?.length ?? 0} entries`;
} catch (e) {
  browseNote = 'offline — skipped';
}
check('library browse (HF reachable)', browseOk, browseNote);

// surface gating: viewer cannot enable... but can we check a gated route on personal space?
const meSpaces = (await call('GET', '/spaces')).json.spaces;
const personal = meSpaces.find((sp) => sp.kind === 'personal');
if (personal) {
  const gated = await call('GET', `/spaces/${personal.id}/code/files`);
  // coding defaults ON
  check('coding surface default on for personal space', gated.status === 200);
  const modelsGated = await call('GET', `/spaces/${personal.id}/models`);
  check('3D surface default off -> 403', modelsGated.status === 403, JSON.stringify(modelsGated.json ?? '').slice(0, 80));
}


// 23. team layer: assignments, notifications, comments
// (token currently belongs to the invited viewer 'smoke@test.local')
const demo2 = await call('POST', '/auth/login', { email: 'demo@set.local', password: 'demo-demo' });
const demoToken2 = demo2.json.token;
const smokeId = reg.json.user.id;
const allPaths = (await call('GET', `/spaces/${team.id}/paths`)).json.paths;
const pathId0 = allPaths[0].id;
const dueIn3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

// assign path to the smoke user with a due date (as owner)
token = demoToken2;
const assignRes = await call('PATCH', `/paths/${pathId0}/assign`, { assignees: [smokeId], dueDate: dueIn3 });
check('assign path to member', assignRes.status === 200, JSON.stringify(assignRes.json ?? '').slice(0, 80));
const roster = (await call('GET', `/paths/${pathId0}/progress/all`)).json;
check('progress rollup lists assignee', roster.members?.some((m) => m.userId === smokeId && m.total === 4), JSON.stringify(roster.members ?? []).slice(0, 120));
const badAssign = await call('PATCH', `/paths/${pathId0}/assign`, { assignees: ['00000000-0000-0000-0000-000000000000'] });
check('assign rejects non-members', badAssign.status === 400);

// viewer cannot comment (403)
token = reg.json.token;
const viewerComment = await call('POST', `/pages/${home.id}/comments`, { body: 'viewer tries' });
check('viewer cannot comment (403)', viewerComment.status === 403);

// upgrade to editor, comment, owner gets a notification
token = demoToken2;
await call('PATCH', `/spaces/${team.id}/members/${smokeId}`, { role: 'editor' });
token = reg.json.token;
const commentRes = await call('POST', `/pages/${home.id}/comments`, { body: 'First comment from the smoke user!' });
check('editor comments on page', commentRes.status === 200);
const listed = (await call('GET', `/pages/${home.id}/comments`)).json.comments;
check('comment listed', listed.some((c) => c.body.includes('First comment')));

// smoke user notifications: assigned + due_soon synthesized
const notifs = (await call('GET', '/notifications')).json;
check('assigned notification present', notifs.notifications.some((n) => n.type === 'assigned' && n.payload.pathId === pathId0));
check('due-soon synthesized', notifs.notifications.some((n) => n.type === 'due_soon' && n.payload.pathId === pathId0), notifs.notifications.map((n) => n.type).join(','));
token = demoToken2;
const demoNotifs = (await call('GET', '/notifications')).json;
check('comment notification for page owner', demoNotifs.notifications.some((n) => n.type === 'comment' && (n.payload.pageId === home.id || n.payload.pageId === undefined)), demoNotifs.notifications.slice(0, 2).map((n) => n.type).join(','));
await call('POST', '/notifications/read');
const afterRead = (await call('GET', '/notifications')).json;
check('mark all read', afterRead.unread === 0);


// 24. @mentions, my-tasks, template kits
// smoke user comments with an @mention of the demo user
token = reg.json.token;
const mentionComment = await call('POST', `/pages/${home.id}/comments`, { body: 'hey @Demo check this out' });
check('@mention comment accepted', mentionComment.status === 200);
token = demoToken2;
const demoNotifs2 = (await call('GET', '/notifications')).json;
check('@mention notification delivered', demoNotifs2.notifications.some((n) => n.type === 'mention' && n.payload.pageId === home.id), demoNotifs2.notifications.slice(0, 3).map((n) => n.type).join(','));

// my-tasks: page checkbox scan + toggle (as smoke user, who is editor + assignee)
token = reg.json.token;
const myTasks = (await call('GET', `/spaces/${team.id}/mytasks`)).json;
check('my-tasks lists assigned path', myTasks.paths?.some((p) => p.total === 4), JSON.stringify(myTasks.paths ?? []).slice(0, 100));
const openTask = myTasks.tasks?.[0];
if (openTask) {
  const toggleRes = await call('POST', `/spaces/${team.id}/mytasks/toggle`, { pageId: openTask.pageId, index: openTask.index, checked: true });
  check('my-tasks toggle completes checkbox', toggleRes.status === 200);
  const after = (await call('GET', `/spaces/${team.id}/mytasks`)).json;
  check('toggled task leaves open list', !after.tasks.some((t) => t.pageId === openTask.pageId && t.index === openTask.index));
} else {
  check('my-tasks finds checkbox tasks', false, 'no tasks found');
}

// template kits: create, export, import
token = demoToken2;
await call('POST', `/spaces/${team.id}/templates`, { title: 'Kit Template: Meeting', markdown: '# Meeting' + String.fromCharCode(10) + 'Attendees:' });
const kit = (await call('GET', `/spaces/${team.id}/templates/export`)).json;
check('kit export contains template', Array.isArray(kit.templates) && kit.templates.some((t) => t.title.includes('Meeting')));
const imported = await call('POST', `/spaces/${team.id}/templates/import`, { kind: 'set-template-kit', templates: [{ title: 'Kit Template: Imported', markdown: '# imported' }] });
check('kit import creates template', imported.status === 200 && imported.json.created === 1);


// 25. password reset flow (no SMTP -> link in server log; we mine the token from the DB via the API is not possible,
// so test with a reset requested then verify unknown-token rejection + rate limiting shape)
const forgot = await call('POST', '/auth/forgot', { email: 'demo@set.local' });
check('forgot always 200', forgot.status === 200);
const badReset = await call('POST', '/auth/reset', { token: 'f'.repeat(64), password: 'newpassword1' });
check('invalid reset token rejected', badReset.status === 400);
const badLogin = await call('POST', '/auth/login', { email: 'demo@set.local', password: 'wrongpassword' });
check('wrong password rejected', badLogin.status === 401);

// 26. activity feed
const acts = (await call('GET', `/spaces/${team.id}/activity`)).json.activities;
check('activity feed records events', acts.length >= 3, acts.slice(0, 3).map((a) => a.type).join(','));
check('activity has actors', acts.every((a) => !!a.actor_name));

// 27. zip import (workspace export style: md with hash links + images + csv)
const AdmZip = (await import('adm-zip')).default;
const zip = new AdmZip();
zip.addFile('Project Home 0123456789abcdef0123456789abcdef.md', Buffer.from('# Project Home' + String.fromCharCode(10) + String.fromCharCode(10) + 'See [[Tasks Board]].' + String.fromCharCode(10) + String.fromCharCode(10) + '![pic](assets/logo.png)'));
zip.addFile('Tasks Board fedcba9876543210fedcba9876543210.md', Buffer.from('# Tasks Board' + String.fromCharCode(10) + String.fromCharCode(10) + '- [ ] first import task'));
zip.addFile('assets/logo.png', Buffer.from('89504e470d0a1a0a', 'hex'));
zip.addFile('Inventory 89abcdef0123456789abcdef01234567.csv', Buffer.from('Name,Qty,Shipped' + String.fromCharCode(10) + 'Widget,5,true' + String.fromCharCode(10) + 'Gadget,12,false'));
const fdZip = new FormData();
fdZip.append('file', new Blob([zip.toBuffer()], { type: 'application/zip' }), 'export.zip');
const zres = await fetch(`${BASE}/spaces/${team.id}/import-zip`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fdZip });
const zjson = await zres.json();
check('zip import: 2 pages + 1 database + 1 image', zres.status === 200 && zjson.pages === 2 && zjson.databases === 1 && zjson.images === 1, JSON.stringify(zjson));
const zpages = (await call('GET', `/spaces/${team.id}/pages`)).json.pages;
const proj = zpages.find((p) => p.title === 'Project Home');
check('hash suffix stripped from titles', !!proj);
const projFull = (await call('GET', `/pages/${proj.id}`)).json.page;
check('internal md link became wiki link', projFull.markdown.includes('[[Tasks Board]]'));
check('image rewritten to served url', projFull.markdown.includes('/api/files/'));
const zdbs = (await call('GET', `/spaces/${team.id}/databases`)).json.databases;
const inv = zdbs.find((d) => d.name === 'Inventory');
const invFull = (await call('GET', `/databases/${inv.id}`)).json;
const qtyCol = invFull.database.schema.find((c) => c.name === 'Qty');
const shipCol = invFull.database.schema.find((c) => c.name === 'Shipped');
check('csv type inference: number + checkbox', qtyCol?.type === 'number' && shipCol?.type === 'checkbox', `${qtyCol?.type}/${shipCol?.type}`);
check('csv rows imported with values', invFull.rows.length === 2 && Number(invFull.rows[0].cells[qtyCol.id]) === 5 && invFull.rows[0].cells[shipCol.id] === true);

console.log(process.exitCode ? 'SMOKE TEST FAILED' : 'ALL SMOKE TESTS PASSED');
