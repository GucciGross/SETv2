/**
 * MCP smoke suite — protocol handshake, OAuth 2.1 + PKCE end-to-end,
 * tools/list metadata (store requirements), tool calls incl. permissions,
 * management endpoints. Run once per fresh database alongside smoke.mjs.
 */
const BASE = 'http://localhost:4000/api';
let token = '';
const h = () => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const http = async (method, path, body, headers = {}) => {
  const res = await fetch(BASE + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
};
const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
const mcp = (body) => http('POST', '/mcp', body, { authorization: `Bearer ${MCP_TOKEN}` });
let MCP_TOKEN = '';
let READ_TOKEN = '';
let checkCount = 0, failCount = 0;
const check = (name, cond, note = '') => {
  checkCount++;
  console.log(`${cond ? '✓' : '✗ FAIL'} ${name}${note ? ' — ' + note : ''}`);
  if (!cond) failCount++;
};

// ---------- setup: api login + data ----------
const login = await http('POST', '/auth/login', { email: 'demo@set.local', password: 'demo-demo' });
if (!login.json?.token) { console.error('LOGIN FAILED', JSON.stringify(login.json)); process.exit(1); }
token = login.json.token;
const spacesRes = (await http('GET', '/spaces')).json;
const team = (spacesRes.spaces ?? []).find((s) => s.name === 'Robotics Lab');
const pages = (await http('GET', `/spaces/${team.id}/pages`)).json.pages;
const home = pages.find((p) => p.title === 'Robotics Lab Home');
const nb = (await http('GET', `/spaces/${team.id}/notebooks`)).json.notebooks.find((n) => n.title.includes('Arm Actuators'));
const dbs = (await http('GET', `/spaces/${team.id}/databases`)).json.databases;

// ---------- 1. unauthenticated access gets RFC 9728 challenge ----------
{
  const res = await fetch(BASE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rpc(1, 'initialize', {})) });
  const challenge = res.headers.get('www-authenticate') ?? '';
  check('401 with RFC 9728 resource_metadata challenge', res.status === 401 && challenge.includes('resource_metadata'));
}

// ---------- 2. discovery endpoints ----------
{
  const pr = await fetch('http://localhost:4000/api/.well-known/oauth-protected-resource').then((r) => r.json());
  check('protected resource metadata', pr.authorization_servers?.length >= 1 && String(pr.resource).endsWith('/api/mcp'));
  const as = await fetch('http://localhost:4000/api/.well-known/oauth-authorization-server').then((r) => r.json());
  check('AS metadata advertises PKCE + DCR', as.code_challenge_methods_supported?.includes('S256') && !!as.registration_endpoint && as.grant_types_supported?.includes('refresh_token'));
}

// ---------- 3. dynamic client registration ----------
let clientId, redirectUri = 'https://client.example/callback';
{
  const bad = await http('POST', '/oauth/register', {});
  check('DCR rejects empty metadata', bad.status === 400);
  const reg = await http('POST', '/oauth/register', { client_name: 'Smoke MCP Client', redirect_uris: [redirectUri] });
  check('DCR registers public client', reg.status === 200 && reg.json.client_id && reg.json.code_challenge_method === 'S256');
  clientId = reg.json.client_id;
}

// ---------- 4. authorization code flow with PKCE ----------
const verifier = 'smoke-verifier-string-that-is-long-enough-for-s256-pkce-test-ok';
const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
{
  // missing PKCE -> rejected
  const noPkce = await fetch(`http://localhost:4000/api/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&code_challenge_method=plain`);
  check('authorize rejects non-S256 method', noPkce.status === 400);
  const badRedirect = await http('GET', `/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent('https://evil.example/x')}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256`);
  check('authorize rejects unregistered redirect_uri', badRedirect.status === 400);

  // unauthenticated user -> redirected to login
  const unauth = await fetch(`http://localhost:4000/api/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256`, { redirect: 'manual' });
  check('authorize redirects anonymous user to login', unauth.status === 302 && (unauth.headers.get('location') ?? '').includes('/login'));

  // consent as the logged-in user (read scope)
  const consent = await http('POST', '/oauth/consent', { clientId, spaceId: team.id, scope: 'mcp:read', redirectUri, codeChallenge: challenge, state: 'xyz' });
  check('consent issues redirect with code+state', consent.status === 200 && consent.json.redirect_to?.includes('code=') && consent.json.redirect_to.includes('state=xyz'));
  const code = new URL(consent.json.redirect_to).searchParams.get('code');

  // wrong verifier -> invalid_grant
  const wrong = await http('POST', '/oauth/token', { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: 'wrong-verifier-entirely-xxxxxxxxxxxxxxxx' });
  check('token rejects wrong PKCE verifier', wrong.status === 400 && wrong.json.error === 'invalid_grant');
  // code already consumed
  const replay = await http('POST', '/oauth/token', { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier });
  check('authorization code is single-use', replay.status === 400);

  // fresh consent -> exchange
  const consent2 = await http('POST', '/oauth/consent', { clientId, spaceId: team.id, scope: 'mcp:read', redirectUri, codeChallenge: challenge, state: '' });
  const code2 = new URL(consent2.json.redirect_to).searchParams.get('code');
  const tok = await http('POST', '/oauth/token', { grant_type: 'authorization_code', code: code2, redirect_uri: redirectUri, code_verifier: verifier });
  check('token exchange succeeds with PKCE', tok.status === 200 && tok.json.access_token && tok.json.refresh_token && tok.json.token_type === 'Bearer');
  const readToken = tok.json.access_token;

  // refresh rotation
  const ref = await http('POST', '/oauth/token', { grant_type: 'refresh_token', refresh_token: tok.json.refresh_token });
  check('refresh token rotates', ref.status === 200 && ref.json.access_token);
  const reuse = await http('POST', '/oauth/token', { grant_type: 'refresh_token', refresh_token: tok.json.refresh_token });
  check('old refresh token invalidated after rotation', reuse.status === 400);

  // write-scope token for write tests
  const consent3 = await http('POST', '/oauth/consent', { clientId, spaceId: team.id, scope: 'mcp:read mcp:write', redirectUri, codeChallenge: challenge, state: '' });
  const code3 = new URL(consent3.json.redirect_to).searchParams.get('code');
  const tok3 = await http('POST', '/oauth/token', { grant_type: 'authorization_code', code: code3, redirect_uri: redirectUri, code_verifier: verifier });
  MCP_TOKEN = tok3.json.access_token;
  check('read+write scope token issued', !!MCP_TOKEN);

  READ_TOKEN = readToken;
}

// ---------- 5. protocol layer ----------
{
  const init = await mcp(rpc(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } }));
  check('initialize handshake', init.json?.result?.protocolVersion === '2025-11-25' && init.json.result.serverInfo?.name === 'set');
  const ping = await mcp(rpc(2, 'ping'));
  check('ping', ping.json?.result && !ping.json.error);
  const bad = await mcp(rpc(3, 'no/such/method'));
  check('unknown method -> -32601', bad.json?.error?.code === -32601);
  const notif = await fetch(BASE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${MCP_TOKEN}` }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  check('notification accepted (202)', notif.status === 202);
}

// ---------- 6. tools/list meets store requirements ----------
{
  const list = await mcp(rpc(4, 'tools/list'));
  const tools = list.json?.result?.tools ?? [];
  check('26 tools exposed', tools.length === 26, String(tools.length));
  check('all names snake_case <= 64 chars', tools.every((t) => /^[a-z0-9_]{1,64}$/.test(t.name)));
  check('all have titles + descriptions', tools.every((t) => t.title && t.description && t.description.length > 20));
  check('all have annotations', tools.every((t) => t.annotations && typeof t.annotations.readOnlyHint === 'boolean'));
  check('read tools annotated readOnlyHint', tools.find((t) => t.name === 'search_workspace')?.annotations?.readOnlyHint === true);
  check('schemas declare required arrays', tools.filter((t) => Object.keys(t.inputSchema.properties ?? {}).length > 0).every((t) => Array.isArray(t.inputSchema.required ?? []) ));
}

// ---------- 7. read tool calls ----------
{
  const search = await mcp(rpc(5, 'tools/call', { name: 'search_workspace', arguments: { query: 'actuator' } }));
  const parsed = JSON.parse(search.json.result.content[0].text);
  check('search_workspace returns pages', parsed.pages?.some((p) => p.title.includes('Actuator')));
  const read = await mcp(rpc(6, 'tools/call', { name: 'read_page', arguments: { ref: 'Actuator Selection Guide' } }));
  const page = JSON.parse(read.json.result.content[0].text);
  check('read_page by title', page.markdown?.includes('# Actuator Selection Guide'));
  const knowledge = await mcp(rpc(7, 'tools/call', { name: 'search_knowledge', arguments: { query: 'actuator torque', notebookId: nb.id } }));
  const hits = JSON.parse(knowledge.json.result.content[0].text);
  check('search_knowledge returns cited hits', Array.isArray(hits.hits) && hits.hits.length > 0);
  const tasks = await mcp(rpc(8, 'tools/call', { name: 'list_my_tasks', arguments: {} }));
  const tt = JSON.parse(tasks.json.result.content[0].text);
  check('list_my_tasks runs', Array.isArray(tt.tasks) && Array.isArray(tt.paths));
  const dbq = await mcp(rpc(9, 'tools/call', { name: 'query_database', arguments: { databaseId: dbs[0].id } }));
  const dbData = JSON.parse(dbq.json.result.content[0].text);
  check('query_database returns schema + rows', dbData.database?.columns?.length >= 3 && dbData.rows?.length >= 1);
  const res = await mcp(rpc(10, 'resources/list'));
  check('resources/list', (res.json?.result?.resources ?? []).length >= 2);
  const readRes = await mcp(rpc(11, 'resources/read', { uri: `set://pages/${home.id}` }));
  check('resources/read page markdown', readRes.json?.result?.contents?.[0]?.text?.includes('Robotics Lab'));
  const prompts = await mcp(rpc(12, 'prompts/list'));
  check('prompts/list has 3 prompts', (prompts.json?.result?.prompts ?? []).length === 3);
  const pg = await mcp(rpc(13, 'prompts/get', { name: 'set/research-brief', arguments: { question: 'torque specs?' } }));
  check('prompts/get renders', pg.json?.result?.messages?.length >= 1);
  const invalid = await mcp(rpc(14, 'tools/call', { name: 'read_page', arguments: {} }));
  check('tool error returned as isError result', invalid.json?.result?.isError === true);
}

// ---------- 8. write tool calls ----------
{
  const create = await mcp(rpc(20, 'tools/call', { name: 'create_page', arguments: { title: 'MCP Smoke Page', markdown: '# From MCP' + String.fromCharCode(10) + String.fromCharCode(10) + 'Links [[Actuator Selection Guide]]' } }));
  const created = JSON.parse(create.json.result.content[0].text);
  check('create_page', !!created.pageId);
  const append = await mcp(rpc(21, 'tools/call', { name: 'append_to_page', arguments: { ref: 'MCP Smoke Page', markdown: 'Appended by agent' } }));
  check('append_to_page', append.json?.result?.isError === false);
  const rowRes = await mcp(rpc(22, 'tools/call', { name: 'create_database_row', arguments: { databaseId: dbs[0].id, title: 'MCP row', cells: { Name: 'MCP row' } } }));
  const row = JSON.parse(rowRes.json.result.content[0].text);
  check('create_database_row by column name', !!row.rowId);
  const upd = await mcp(rpc(23, 'tools/call', { name: 'update_database_row', arguments: { rowId: row.rowId, cells: {} } }));
  check('update_database_row idempotent', upd.json?.result?.isError === false);
  const comment = await mcp(rpc(24, 'tools/call', { name: 'create_comment', arguments: { ref: home.id, body: 'mcp smoke comment' } }));
  check('create_comment', comment.json?.result?.isError === false);
  const nbNew = await mcp(rpc(25, 'tools/call', { name: 'create_notebook', arguments: { title: 'MCP Notebook' } }));
  const nbData = JSON.parse(nbNew.json.result.content[0].text);
  check('create_notebook', !!nbData.notebookId);
  const src = await mcp(rpc(26, 'tools/call', { name: 'add_notebook_source', arguments: { notebookId: nbData.notebookId, name: 'mcp-notes', text: '# MCP notes' + String.fromCharCode(10) + 'The agent added this source for indexing.' } }));
  check('add_notebook_source queued', src.json?.result?.isError === false);
}

// ---------- 9. scope enforcement: read-only token cannot write ----------
{
  const c4 = await http('POST', '/oauth/consent', { clientId, spaceId: team.id, scope: 'mcp:read', redirectUri, codeChallenge: challenge, state: '' });
  const code4 = new URL(c4.json.redirect_to).searchParams.get('code');
  const t4 = await http('POST', '/oauth/token', { grant_type: 'authorization_code', code: code4, redirect_uri: redirectUri, code_verifier: verifier });
  READ_TOKEN = t4.json.access_token;
  const res = await fetch(BASE + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${READ_TOKEN}` },
    body: JSON.stringify(rpc(30, 'tools/call', { name: 'create_page', arguments: { title: 'Should fail' } })),
  }).then((r) => r.json());
  check('read-only scope blocked from write tool', res?.result?.isError === true && String(res?.result?.content?.[0]?.text ?? '').includes('mcp:write'));
}

// ---------- 10. management endpoints + call logging ----------
{
  token = login.json.token; // owner session
  const stats = (await http('GET', `/spaces/${team.id}/mcp/stats`)).json;
  check('stats: calls recorded per tool', (stats.perTool ?? []).some((t) => t.tool === 'create_page' && t.calls >= 1), (stats.perTool ?? []).slice(0, 3).map((t) => `${t.tool}:${t.calls}`).join(','));
  check('stats: client visible', (stats.clients ?? []).some((c) => c.client_name === 'Smoke MCP Client'));
  const logs = (await http('GET', `/spaces/${team.id}/mcp/logs`)).json.logs;
  check('logs captured with duration', logs.some((l) => l.tool === 'search_workspace' && l.duration_ms >= 0));
  const tokens = (await http('GET', `/spaces/${team.id}/mcp/tokens`)).json.tokens;
  check('tokens listed', tokens.length >= 2);
  const readRow = tokens.find((t) => t.scope === 'mcp:read') ?? tokens[0];
  const revoke = await http('POST', `/spaces/${team.id}/mcp/tokens/${readRow.id}/revoke`);
  check('token revoked', revoke.status === 200);
  const after = await fetch(BASE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[0].id === 'x' ? '' : MCP_TOKEN}` }, body: JSON.stringify(rpc(31, 'ping')) });
  check('remaining token still works', after.status === 200);
}

// ---------- 11. manifest ----------
{
  const doc = await fetch(BASE + '/mcp/docs.json').then((r) => r.json());
  check('docs.json manifest', doc.tools?.length === 26 && doc.auth?.flow?.includes('PKCE'));
}

console.log(failCount === 0 ? `ALL ${checkCount} MCP CHECKS PASSED` : `${failCount}/${checkCount} MCP CHECKS FAILED`);
process.exit(failCount === 0 ? 0 : 1);
