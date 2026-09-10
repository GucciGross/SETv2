/** No sign-in or model requests. Probe the pinned official binary's managed-account protocol. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexSessions } from '../dist/codex/sessions.js';
process.env.SET_DEPLOYMENT_MODE = 'self-hosted'; process.env.SET_CODEX_OAUTH_ENABLED = '1';
const dir = await mkdtemp(join(tmpdir(), 'set-codex-cli-'));
const sessions = new CodexSessions(dir);
try {
  const status = await sessions.status('protocol-smoke');
  assert.equal(status.connected, false); assert.equal(status.selected, false); assert.equal(status.account, null);
  assert.equal(await sessions.acquire('protocol-smoke'), null);
  console.log('PASS official Codex CLI: private process, initialize, managed account/read, no credentials and no model request');
} finally { await sessions.close(); await rm(dir, { recursive: true, force: true }); }
