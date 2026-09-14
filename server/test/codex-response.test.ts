import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CodexBridge } from '../src/codex/bridge.js';
import type { CodexRpc } from '../src/codex/rpc.js';

// Protocol fixtures from the documented v2 item lifecycle. Only RPC IO is fake.
// https://developers.openai.com/codex/app-server/#item-deltas
for (const mode of ['final-only', 'streamed', 'partial', 'multiple', 'foreign', 'mismatch'] as const) {
  test(`Codex completed agent-message snapshot: ${mode}`, async () => {
    const oldMode = process.env.SET_DEPLOYMENT_MODE, oldEnabled = process.env.SET_CODEX_OAUTH_ENABLED;
    process.env.SET_DEPLOYMENT_MODE = 'self-hosted'; process.env.SET_CODEX_OAUTH_ENABLED = '1';
    const events = new EventEmitter();
    const notify = (method: string, params: any) => events.emit('notification', { method, params: { threadId: 'thread', turnId: 'turn', ...params } });
    const delta = (id: string, text: string) => notify('item/agentMessage/delta', { itemId: id, delta: text });
    const final = (id: string, text: string) => notify('item/completed', { item: { id, type: 'agentMessage', text } });
    let released = 0;
    const rpc = {
      events, isClosed: false, stop() {},
      async request(method: string) {
        if (method === 'thread/start') return { thread: { id: 'thread' } };
        if (method === 'turn/start') {
          // Emit before the request continuation, just like multiple JSON lines in one pipe read.
          if (mode === 'streamed') delta('answer', 'Hello from SET.');
          if (mode === 'partial') delta('answer', 'Hello');
          if (mode === 'mismatch') delta('answer', 'Different text');
          if (mode === 'multiple') { delta('comment', 'Checking. '); final('comment', 'Checking. '); }
          if (mode === 'foreign') {
            notify('item/completed', { threadId: 'someone-else', item: { id: 'foreign', type: 'agentMessage', text: 'Private text' } });
            notify('item/completed', { item: { id: 'reasoning', type: 'reasoning', text: 'Do not show reasoning' } });
          }
          final('answer', 'Hello from SET.');
          final('answer', 'Hello from SET.'); // idempotent completion
          notify('turn/completed', { turn: { id: 'turn', status: 'completed' } });
          return { turn: { id: 'turn' } };
        }
        return {};
      },
    };
    const bridge = new CodexBridge(rpc as unknown as CodexRpc, '/tmp/disposable', () => { released++; });
    const deltas: string[] = [];
    try {
      const completion = bridge.complete({ messages: [{ role: 'user', content: 'Hello?' }] }, d => deltas.push(d));
      if (mode === 'mismatch') await assert.rejects(completion, /changed while streaming/i);
      else {
        const result = await completion;
        const expected = (mode === 'multiple' ? 'Checking. ' : '') + 'Hello from SET.';
        assert.equal(result.content, expected);
        assert.equal(deltas.join(''), expected);
        assert.deepEqual(result.tool_calls, []);
      }
    } finally {
      await bridge.close();
      assert.equal(released, 1); assert.equal(events.listenerCount('notification'), 0);
      if (oldMode === undefined) delete process.env.SET_DEPLOYMENT_MODE; else process.env.SET_DEPLOYMENT_MODE = oldMode;
      if (oldEnabled === undefined) delete process.env.SET_CODEX_OAUTH_ENABLED; else process.env.SET_CODEX_OAUTH_ENABLED = oldEnabled;
    }
  });
}
