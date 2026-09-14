import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { codexSessions } from '../src/codex/service.js';
import { SetAgent } from '../src/copilotkit/agent.js';

for (const mode of ['final-only', 'streamed', 'empty', 'failure'] as const) {
  test(`Copilot text response reaches the real AG-UI client: ${mode}`, async () => {
    const spaceId = crypto.randomUUID(), userId = crypto.randomUUID(), runId = crypto.randomUUID();
    let closed = 0, requests = 0, persistedStatus = '';
    const query = mock.method(pool, 'query', (async (sql: string, params: any[]) => {
      if (sql.startsWith('UPDATE agent_runs')) persistedStatus = sql.includes("status = 'error'") ? 'error' : params[2];
      return { rows: sql.includes('FROM memberships') ? [{ role: 'owner' }]
        : sql.includes('INSERT INTO agent_runs') ? [{ id: runId }] : [] };
    }) as any);
    const acquire = mock.method(codexSessions, 'acquire', (async () => ({
      signal: new AbortController().signal,
      async complete(_opts: unknown, onDelta: (text: string) => void) {
        requests++;
        if (mode === 'failure') throw new Error('Selected Codex account needs sign-in.');
        if (mode === 'streamed') { onDelta('Hello'); onDelta(' from SET.'); }
        return { content: mode === 'empty' ? null : 'Hello from SET.', tool_calls: [], raw: {} };
      },
      async close() { closed++; },
    })) as any);
    const network = mock.method(globalThis, 'fetch', (async () => { throw new Error('No paid API fallback permitted'); }) as typeof fetch);
    try {
      const agent = new SetAgent({ id: userId, name: 'Tester' }, { guide: true });
      agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: 'Hello?' });
      const events: any[] = [];
      let runError = '';
      await agent.runAgent({ forwardedProps: { spaceId } }, {
        onEvent: ({ event }) => { events.push(event); },
        onRunErrorEvent: ({ event }) => { runError = event.message; },
      });
      const text = agent.messages.filter(m => m.role === 'assistant').map(m => m.content ?? '').join('');
      assert.equal(requests, 1, 'a failed turn must not be silently replayed');
      assert.equal(closed, 1);
      if (mode === 'empty' || mode === 'failure') {
        assert.match(runError, mode === 'empty' ? /empty response/i : /sign-in/);
        assert.equal(events.some(e => e.type === 'RUN_FINISHED'), false);
        assert.equal(persistedStatus, 'error');
      } else {
        assert.equal(runError, '');
        assert.equal(text, 'Hello from SET.', 'not just saved in the database: visible in AG-UI messages exactly once');
        const types = events.map(e => e.type);
        assert.equal(types.filter(t => t === 'TEXT_MESSAGE_START').length, 1);
        assert.equal(types.filter(t => t === 'TEXT_MESSAGE_END').length, 1);
        assert.ok(types.indexOf('TEXT_MESSAGE_END') < types.indexOf('RUN_FINISHED'));
        assert.equal(persistedStatus, 'finished');
      }
    } finally { query.mock.restore(); acquire.mock.restore(); network.mock.restore(); }
  });
}
