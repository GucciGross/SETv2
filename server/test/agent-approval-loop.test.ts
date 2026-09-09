import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { runAgentLoop } from '../src/agents/engine.js';
import { getTool } from '../src/agents/tools.js';
import { ApprovalGates, approvalGates } from '../src/agents/approvals.js';

for (const outcome of ['approve', 'reject', 'expired', 'cancelled', 'revoked'] as const) {
  test(`agent loop: ${outcome} preserves approval policy and prevents unapproved fallback writes`, async () => {
    const spaceId = crypto.randomUUID(), userId = crypto.randomUUID(), runId = crypto.randomUUID();
    const calls: string[] = [], events: { type: string; payload: any }[] = [], persisted: any[] = [];
    const abort = new AbortController();
    let providerCalls = 0, role = 'editor';
    const gates = new ApprovalGates(outcome === 'expired' ? 10 : 1000);
    const query = mock.method(pool, 'query', (async (sql: string, params: any[] = []) => {
      if (sql.startsWith('UPDATE agent_runs') && sql.includes('tool_log')) persisted.push(JSON.parse(params[3]));
      return { rows: sql.includes('INSERT INTO agent_runs') ? [{ id: runId }]
        : sql.includes('FROM providers') ? [{ base_url: 'http://fixture.invalid', chat_model: 'fixture' }]
          : sql.includes('FROM settings') ? [{ data: { agentApprovals: true } }]
            : sql.includes('FROM memberships') ? [{ role }] : [] };
    }) as any);
    const request = mock.method(approvalGates, 'request', (r, opts) => gates.request(r, opts));
    const tool = mock.method(getTool('h5p_create_draft')!, 'run', async () => { calls.push('write'); return { ok: true, result: { activity: { id: 'draft' } } }; });
    const network = mock.method(globalThis, 'fetch', (async () => {
      providerCalls++;
      const delta = providerCalls === 1 ? { tool_calls: [
        { index: 0, id: 'write-1', function: { name: 'h5p_create_draft', arguments: '{"title":"Lesson"}' } },
        { index: 1, id: 'write-1', function: { name: 'insert_into_editor', arguments: '{"markdown":"Do not bypass approval"}' } },
      ] } : { content: 'Done' };
      return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch);
    try {
      await runAgentLoop({ spaceId, userId, message: 'Make an H5P activity', requireApprovals: false,
        signal: abort.signal,
        extraTools: [{ type: 'function', function: { name: 'insert_into_editor', description: 'Frontend write', parameters: {} } }],
        emit: (type, payload) => {
          events.push({ type, payload });
          if (type === 'CUSTOM' && payload.subtype === 'approval_request') {
            if (outcome === 'cancelled') abort.abort();
            else if (outcome !== 'expired') {
              if (outcome === 'revoked') role = 'viewer';
              gates.decide(runId, payload.callId, outcome === 'reject' ? 'reject' : 'approve');
            }
          }
        },
      });
      assert.equal(events.filter((e) => e.payload?.subtype === 'approval_request').length, 1, 'request cannot disable workspace policy');
      assert.equal(calls.length, outcome === 'approve' ? 1 : 0);
      assert.equal(providerCalls, 1);
      const starts = events.filter((e) => e.type === 'TOOL_CALL_START');
      assert.equal(new Set(starts.map((e) => e.payload.callId)).size, 2, 'provider id collisions are normalized');
      const result = events.find((e) => e.type === 'TOOL_CALL_END' && e.payload.name === 'h5p_create_draft')?.payload.result;
      if (outcome === 'expired') { assert.equal(result.approval.status, 'expired'); assert.equal(result.rejected, undefined); }
      if (outcome === 'reject') assert.equal(result.approval.status, 'rejected');
      if (['reject', 'expired', 'cancelled', 'revoked'].includes(outcome)) {
        const fallback = events.find((e) => e.type === 'TOOL_CALL_END' && e.payload.name === 'insert_into_editor')?.payload.result;
        assert.equal(fallback.executed, false);
        assert.equal(fallback.skipped, true);
        assert.equal(events.some((e) => e.payload?.result === 'Forwarded to client'), false);
      }
      assert.ok(persisted.some((log) => log.some((entry: any) => entry.approval?.status === 'pending')));
      assert.ok(persisted.some((log) => log.some((entry: any) => entry.approval?.resolvedAt)));
    } finally { query.mock.restore(); request.mock.restore(); tool.mock.restore(); network.mock.restore(); abort.abort(); }
  });
}
