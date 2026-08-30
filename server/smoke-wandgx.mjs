/**
 * WandGx connector smoke test — runs against a live SET server that was
 * started with the stub connector env, e.g.:
 *
 *   WANDGX_URL=http://127.0.0.1:4101 WANDGX_TOKEN=stub-token \
 *   WANDGX_WEBHOOK_SECRET=stub-secret npm run dev
 *
 * then: npm run smoke:wandgx
 * Spawns the stub itself; needs the demo seed (demo@set.local / demo-demo).
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const BASE = process.env.SET_BASE ?? 'http://localhost:4000/api';
const STUB_URL = process.env.STUB_URL; // reuse an already-running stub instead of spawning one
const STUB_TOKEN = process.env.WANDGX_TOKEN ?? 'stub-token';
const STUB_SECRET = process.env.WANDGX_WEBHOOK_SECRET ?? 'stub-secret';
let token = '';
const h = () => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const call = async (method, path, body, headers = {}) => {
  const res = await fetch(BASE + path, { method, headers: { ...h(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
};
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗ FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};

let stub = null;
if (!STUB_URL) {
  stub = spawn(process.execPath, ['scripts/wandgx-stub.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: '4101', SET_URL: process.env.SET_URL ?? 'http://127.0.0.1:4000', WANDGX_TOKEN: STUB_TOKEN, WANDGX_WEBHOOK_SECRET: STUB_SECRET },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  stub.stdout.on('data', (d) => process.stdout.write(`  ${d}`));
  stub.stderr.on('data', (d) => process.stderr.write(`  ${d}`));
}
const die = () => { stub?.kill(); process.exit(process.exitCode ?? 0); };
process.on('SIGINT', die);

try {
  await new Promise((r) => setTimeout(r, 400));

  // 0. stub + connector health
  const stubHealth = await fetch(`${STUB_URL ?? 'http://127.0.0.1:4101'}/health`).then((r) => r.json()).catch(() => null);
  check('stub is up', stubHealth?.ok === true);

  let r = await call('POST', '/auth/login', { email: 'demo@set.local', password: 'demo-demo' });
  check('login demo user', r.status === 200 && r.json.token);
  token = r.json.token;

  // 1. fresh space with the WandGx surface enabled
  r = await call('POST', '/spaces', { name: `WandGx Smoke ${Date.now()}` });
  check('create space', r.status === 200 && r.json.space?.id);
  const spaceId = r.json.space.id;
  const settings = (await call('GET', `/spaces/${spaceId}/settings`)).json.settings ?? {};
  r = await call('PATCH', `/spaces/${spaceId}/settings`, { settings: { ...settings, surfaces: { ...(settings.surfaces ?? {}), wandgx: true } } });
  check('enable wandgx surface', r.status === 200);

  // 2. a page to track the build
  r = await call('POST', '/pages', { spaceId, title: 'CHIP-8 Emulator — my build', markdown: 'Working through the tutorial. Build log below.' });
  const page = r.json.page;
  check('create tracking page', !!page?.id);

  // 3. start a build
  r = await call('POST', `/spaces/${spaceId}/wandgx/builds`, { prompt: 'A CHIP-8 emulator in C with a simple SDL frontend, guided by the Building a CHIP-8 Emulator tutorial', title: 'CHIP-8 starter', pageId: page.id });
  check('start build (201)', r.status === 201 && r.json.build?.status === 'building', `status=${r.status} build=${r.json.build?.status} err=${r.json.error ?? ''}`);
  const buildRow = r.json.build;

  // 4. webhook lands: build log on the page + deployed row
  let deployed = false;
  let pageAfter = null;
  for (let i = 0; i < 15 && !deployed; i++) {
    await new Promise((res) => setTimeout(res, 500));
    pageAfter = (await call('GET', `/pages/${page.id}`)).json.page;
    const builds = (await call('GET', `/spaces/${spaceId}/wandgx/builds`)).json.builds;
    deployed = builds?.some((b) => b.id === buildRow.id && b.status === 'deployed');
  }
  check('webhook marked build deployed', deployed);
  check('build log appended to page', (pageAfter?.markdown ?? '').includes('## Build log') && pageAfter.markdown.includes('Build started'));
  check('live + repo urls on page', pageAfter.markdown.includes('](https://github.com/wandgx-stub/') && /live\]\(http/.test(pageAfter.markdown));

  // 5. status endpoint
  r = await call('GET', `/spaces/${spaceId}/wandgx/status`);
  check('status endpoint reports reachable', r.status === 200 && r.json.reachable === true && r.json.configured === true);

  // 6. negative: surface gate
  r = await call('POST', '/spaces', { name: `WandGx Off ${Date.now()}` });
  const offSpace = r.json.space.id;
  r = await call('POST', `/spaces/${offSpace}/wandgx/builds`, { prompt: 'should be rejected' });
  check('surface disabled → 403', r.status === 403, `status=${r.status}`);

  // 7. negative: webhook signature
  const badBody = JSON.stringify({ spaceId, type: 'build.failed', buildRowId: buildRow.id, status: 'error', error: 'forged' });
  const badTs = String(Date.now());
  const badSig = crypto.createHmac('sha256', 'wrong-secret').update(`${spaceId}.${badTs}.evt_bad.${badBody}`).digest('hex');
  r = await call('POST', '/wandgx/events', badBody, {
    authorization: '',
    'x-wandgx-signature': badSig,
    'x-wandgx-timestamp': badTs,
    'x-wandgx-event-id': 'evt_bad',
  });
  check('bad webhook signature → 401', r.status === 401, `status=${r.status}`);

  // 8. machine health endpoint
  const mh = await fetch(`${BASE}/wandgx/health`, { headers: { authorization: `Bearer ${STUB_TOKEN}` } });
  check('wandgx health (token)', mh.status === 200);

  console.log(process.exitCode ? '\nWandGx smoke: FAILURES above' : '\nWandGx smoke: all checks passed');
} finally {
  die();
}
