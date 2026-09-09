import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { runAgentLoop } from '../src/agents/engine.js';

for (const clientThreadId of ['client-thread', crypto.randomUUID()]) {
  test(`Copilot DB history keeps prior context for ${clientThreadId.length === 36 ? 'UUID' : 'named'} threads and scopes resource reads`, async () => {
    const spaceId = crypto.randomUUID(), userId = crypto.randomUUID(), runId = crypto.randomUUID();
    const pageId = crypto.randomUUID(), notebookId = crypto.randomUUID();
    let priorLoaded = false, resourceReads = 0, providerCalls = 0;
    const prior = [{ role: 'user', content: 'Earlier training objective' }, { role: 'assistant', content: 'Keep the original assessment.' }];
    const query = mock.method(pool, 'query', (async (sql: string, params: any[] = []) => {
      if (sql.includes('SELECT thread FROM agent_runs')) {
        assert.match(sql, /client_thread_id = \$1/);
        assert.match(sql, /space_id = \$2 AND user_id = \$3 AND id <> \$4/);
        assert.deepEqual(params, [clientThreadId, spaceId, userId, runId]);
        priorLoaded = true;
        return { rows: [{ thread: prior }] };
      }
      if (sql.includes('FROM pages') || sql.includes('FROM notebooks')) {
        assert.match(sql, /space_id = \$2/);
        assert.equal(params[1], spaceId);
        resourceReads++;
        return { rows: [] }; // foreign/missing ids reveal no context
      }
      return { rows: sql.includes('INSERT INTO agent_runs') ? [{ id: runId }]
        : sql.includes('FROM providers') ? [{ base_url: 'http://fixture.invalid', chat_model: 'fixture' }]
          : sql.includes('FROM settings') ? [{ data: { agentApprovals: true } }] : [] };
    }) as any);
    const network = mock.method(globalThis, 'fetch', (async (_url: unknown, options: any) => {
      providerCalls++;
      const messages = JSON.parse(options.body).messages;
      assert.ok(messages.some((m: any) => m.content === 'Earlier training objective'));
      assert.ok(messages.some((m: any) => m.content === 'Keep the original assessment.'));
      assert.ok(messages.some((m: any) => m.content === 'Continue the lesson'));
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Continuing with the original assessment.' } }] })}\n\ndata: [DONE]\n\n`);
    }) as typeof fetch);
    try {
      await runAgentLoop({ spaceId, userId, threadId: clientThreadId, source: 'copilot', message: 'Continue the lesson', context: { pageId, notebookId }, emit: () => {} });
      assert.ok(priorLoaded);
      assert.equal(resourceReads, 2);
      assert.equal(providerCalls, 1);
    } finally { query.mock.restore(); network.mock.restore(); }
  });
}
