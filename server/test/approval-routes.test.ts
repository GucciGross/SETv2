import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { pool } from '../src/db.js';
import { signToken } from '../src/lib/tokens.js';
import { agentRoutes } from '../src/agents/routes.js';
import { approvalGates } from '../src/agents/approvals.js';

test('approval REST enforces owner, current membership, specific call and idempotent acknowledgements', async () => {
  const runId = crypto.randomUUID(), userId = crypto.randomUUID(), spaceId = crypto.randomUUID();
  const token = signToken({ id: userId, name: 'Author', email: 'author@example.invalid' });
  let role: string | undefined = 'editor';
  const database = mock.method(pool, 'query', (async (text: string) => ({ rows:
    text.includes('FROM agent_runs') ? [{ user_id: userId, space_id: spaceId }]
      : text.includes('FROM memberships') ? role ? [{ role }] : [] : []
  })) as any);
  const app = Fastify();
  await app.register(agentRoutes);
  const signal = new AbortController();
  const waiting = approvalGates.request({ runId, spaceId, callId: 'exact-call', threadId: 'thread', tool: 'create_page', args: {} }, { signal: signal.signal });
  const send = (payload: unknown, auth = token) => app.inject({ method: 'POST', url: `/agent/runs/${runId}/approve`, headers: { authorization: `Bearer ${auth}` }, payload });
  try {
    assert.equal((await send({ callId: 'exact-call', decision: 'approve' }, '')).statusCode, 401);
    const other = signToken({ id: crypto.randomUUID(), name: 'Other', email: 'other@example.invalid' });
    assert.equal((await send({ callId: 'exact-call', decision: 'approve' }, other)).statusCode, 404);
    assert.equal((await send({ decision: 'approve' })).statusCode, 400);
    assert.equal((await send({ callId: 'stale', decision: 'approve' })).statusCode, 409);
    role = undefined;
    assert.equal((await send({ callId: 'exact-call', decision: 'approve' })).statusCode, 404);
    role = 'viewer';
    assert.equal((await send({ callId: 'exact-call', decision: 'approve' })).statusCode, 403);
    assert.equal(approvalGates.get(runId, 'exact-call')?.status, 'pending');
    role = 'editor';
    const approved = await send({ callId: 'exact-call', decision: 'approve' });
    assert.equal(approved.statusCode, 200);
    assert.equal(approved.json().status, 'approved');
    assert.equal(await waiting, 'approved');
    assert.equal((await send({ callId: 'exact-call', decision: 'approve' })).statusCode, 200);
    assert.equal((await send({ callId: 'exact-call', decision: 'reject' })).statusCode, 409);
    const status = await app.inject({ url: `/agent/runs/${runId}/approvals/exact-call`, headers: { authorization: `Bearer ${token}` } });
    assert.equal(status.json().status, 'approved');
    assert.equal(status.headers['cache-control'], 'no-store');
    const unknown = await app.inject({ url: `/agent/runs/${runId}/approvals/after-restart`, headers: { authorization: `Bearer ${token}` } });
    assert.equal(unknown.json().status, 'unavailable');
  } finally { signal.abort(); await waiting; database.mock.restore(); await app.close(); }
});
