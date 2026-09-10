import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { runAgentLoop } from '../src/agents/engine.js';
import { getTool } from '../src/agents/tools.js';
import { ApprovalGates, approvalGates } from '../src/agents/approvals.js';
import { codexSessions } from '../src/codex/service.js';
import { CodexError } from '../src/codex/policy.js';

for (const outcome of ['approve', 'reject', 'revoked', 'disconnect', 'login-required', 'api-source'] as const) {
  test(`personal Codex through shared SET engine: ${outcome}`, async () => {
    const spaceId = crypto.randomUUID(), userId = crypto.randomUUID(), runId = crypto.randomUUID();
    const events: { type: string; payload: any }[] = [];
    let writes = 0, networkCalls = 0, completionCalls = 0, closed = 0, acquired = 0, role = 'editor';
    const cancel = new AbortController(), gates = new ApprovalGates(1000);
    const call = { id: 'upstream-call', type: 'function', function: { name: 'h5p_create_draft', arguments: '{"title":"Lesson"}' } };
    const database = mock.method(pool, 'query', (async (sql: string) => ({ rows: sql.includes('INSERT INTO agent_runs') ? [{ id: runId }]
      : sql.includes('FROM settings') ? [{ data: { agentApprovals: true } }]
        : sql.includes('FROM memberships') ? [{ role }]
          : sql.includes('FROM providers') && outcome === 'login-required' ? [{ base_url: 'https://never-call.invalid', chat_model: 'fixture' }] : [] })) as any);
    const acquire = mock.method(codexSessions, 'acquire', (async (id: string) => {
      acquired++; assert.equal(id, userId);
      if (outcome === 'login-required') throw new CodexError(409, 'Selected Codex account needs sign-in.');
      return { signal: cancel.signal, async complete(opts: any) {
        completionCalls++;
        if (completionCalls === 1) return { content: null, tool_calls: [call], raw: {} };
        const result = opts.messages.find((m: any) => m.role === 'tool');
        assert.equal(result.tool_call_id, call.id); assert.match(call.id, /^set_/);
        assert.match(result.content, /verified-draft/);
        return { content: 'Verified.', tool_calls: [], raw: {} };
      }, async close() { closed++; } };
    }) as any);
    const approval = mock.method(approvalGates, 'request', (r, opts) => gates.request(r, opts));
    const write = mock.method(getTool('h5p_create_draft')!, 'run', async (_args, context) => {
      assert.equal(context.provider, null); writes++; return { ok: true, result: { activity: { id: 'verified-draft' } } };
    });
    const network = mock.method(globalThis, 'fetch', (async () => { networkCalls++; throw new Error('No API fallback permitted in this test'); }) as typeof fetch);
    try {
      await runAgentLoop({ spaceId, userId, message: 'Create the lesson', source: outcome === 'api-source' ? 'api' : 'guide', requireApprovals: false,
        emit: (type, payload) => {
          events.push({ type, payload });
          if (type === 'CUSTOM' && payload.subtype === 'approval_request') {
            if (outcome === 'disconnect') cancel.abort();
            else { if (outcome === 'revoked') role = 'viewer'; gates.decide(runId, payload.callId, outcome === 'reject' ? 'reject' : 'approve'); }
          }
        },
      });
      assert.equal(networkCalls, 0, 'subscription failures must never silently use a paid API');
      assert.equal(acquired, outcome === 'api-source' ? 0 : 1, 'background/API source cannot consume personal subscription');
      assert.equal(writes, outcome === 'approve' ? 1 : 0);
      assert.equal(completionCalls, outcome === 'approve' ? 2 : ['api-source', 'login-required'].includes(outcome) ? 0 : 1);
      assert.equal(closed, ['api-source', 'login-required'].includes(outcome) ? 0 : 1);
      if (outcome === 'login-required') assert.ok(events.some(e => e.type === 'RUN_ERROR' && /needs sign-in/.test(e.payload.message)));
      else if (outcome !== 'api-source') assert.equal(events.filter(e => e.payload?.subtype === 'approval_request').length, 1);
    } finally { database.mock.restore(); acquire.mock.restore(); approval.mock.restore(); write.mock.restore(); network.mock.restore(); cancel.abort(); }
  });
}
