#!/usr/bin/env node
/**
 * Minimal WandGx stand-in for local development and smoke tests — no real
 * WandGx needed. Implements the two endpoints the SET connector uses:
 *
 *   POST /set/builds  → accepts {title, prompt, source:{spaceId, buildRowId}},
 *                       replies {projectId, buildId, status}, then fires the
 *                       HMAC-signed build.deployed webhook back at SET.
 *   GET  /health      → liveness probe.
 *
 * Env: PORT (4101), SET_URL (http://127.0.0.1:4000), WANDGX_TOKEN,
 *      WANDGX_WEBHOOK_SECRET, WANDGX_STUB_LIVE_BASE.
 */
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT ?? 4101);
const SET_URL = process.env.SET_URL ?? 'http://127.0.0.1:4000';
const TOKEN = process.env.WANDGX_TOKEN ?? 'stub-token';
const SECRET = process.env.WANDGX_WEBHOOK_SECRET ?? 'stub-secret';
const LIVE_BASE = process.env.WANDGX_STUB_LIVE_BASE ?? 'http://localhost:3200/stub';

let n = 0;

async function fireWebhook(source, buildId, slug) {
  const body = JSON.stringify({
    spaceId: source.source?.spaceId,
    buildRowId: source.source?.buildRowId,
    buildId,
    type: 'build.deployed',
    status: 'deployed',
    repoUrl: `https://github.com/wandgx-stub/${slug}`,
    liveUrl: `${LIVE_BASE}/${slug}`,
  });
  const ts = String(Date.now());
  const eventId = `evt_${crypto.randomUUID()}`;
  const sig = crypto.createHmac('sha256', SECRET).update(`${source.source?.spaceId}.${ts}.${eventId}.${body}`).digest('hex');
  try {
    const res = await fetch(`${SET_URL}/api/wandgx/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-wandgx-signature': sig,
        'x-wandgx-timestamp': ts,
        'x-wandgx-event-id': eventId,
      },
      body,
    });
    console.log(`[wandgx-stub] webhook (${source.title ?? 'build'}) -> ${res.status}`);
  } catch (err) {
    console.error(`[wandgx-stub] webhook failed: ${err.message}`);
  }
}

const server = http.createServer(async (req, res) => {
  const json = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'GET' && req.url === '/health') return json(200, { ok: true, service: 'wandgx-stub' });
  if (req.method === 'POST' && req.url.endsWith('/set/builds')) {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: 'bad token' });
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body || '{}');
    const id = ++n;
    const buildId = `stub_${id}`;
    const slug = `app-${buildId}`;
    const timer = setTimeout(() => fireWebhook(payload, buildId, slug), 1200);
    timer.unref?.();
    return json(201, { projectId: `stub_proj_${id}`, buildId, status: 'building' });
  }
  return json(404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`[wandgx-stub] listening on :${PORT} (SET at ${SET_URL})`));
