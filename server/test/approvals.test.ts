import test from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalGates, approvalStopResult } from '../src/agents/approvals.js';
const request = { runId: 'run', callId: 'call', threadId: 'thread', spaceId: 'space', tool: 'h5p_create_draft', args: { title: 'Lesson' } };

test('approval is registered before the event and can be approved immediately', async () => {
  const gates = new ApprovalGates();
  const outcome = gates.request(request, { onRequest: (a) => {
    assert.equal(a.status, 'pending');
    assert.equal(gates.decide(a.runId, a.callId, 'approve')?.status, 'approved');
  } });
  assert.equal(await outcome, 'approved');
});
test('stale and run-only decisions never authorize another tool', async () => {
  const gates = new ApprovalGates();
  const first = gates.request(request);
  assert.equal(gates.decide('run', 'wrong', 'approve'), undefined);
  gates.decide('run', 'call', 'approve');
  await first;
  const second = gates.request({ ...request, callId: 'next' });
  // Retry of the first receipt is idempotent, and cannot settle the second gate.
  assert.equal(gates.decide('run', 'call', 'approve')?.status, 'approved');
  assert.equal(gates.get('run', 'next')?.status, 'pending');
  assert.equal(gates.decide('other-run', 'next', 'approve'), undefined);
  gates.decide('run', 'next', 'reject');
  assert.equal(await second, 'rejected');
});
test('timeouts are expired, not rejected; no late decision can execute', async () => {
  const gates = new ApprovalGates(10);
  assert.equal(await gates.request(request), 'expired');
  assert.equal(gates.decide('run', 'call', 'approve'), undefined);
  assert.equal(gates.decide('run', 'call', 'reject'), undefined);
  assert.equal('rejected' in approvalStopResult('expired'), false);
  assert.match(approvalStopResult('expired').note, /did NOT reject/);
});
test('abort clears the live gate and is not a user rejection', async () => {
  const gates = new ApprovalGates();
  const abort = new AbortController();
  const waiting = gates.request(request, { signal: abort.signal });
  abort.abort();
  assert.equal(await waiting, 'cancelled');
  assert.equal(gates.decide('run', 'call', 'approve'), undefined);
});
test('an already aborted run never requests human approval', async () => {
  const abort = new AbortController(); abort.abort();
  assert.equal(await new ApprovalGates().request(request, { signal: abort.signal, onRequest: () => assert.fail('already aborted') }), 'cancelled');
});
test('opposite decisions cannot rewrite a receipt', async () => {
  const gates = new ApprovalGates();
  const waiting = gates.request(request);
  gates.decide('run', 'call', 'reject');
  assert.equal(await waiting, 'rejected');
  assert.equal(gates.decide('run', 'call', 'approve'), undefined);
  assert.equal(gates.decide('run', 'call', 'reject')?.status, 'rejected');
});
test('completed receipts are bounded and replay cannot allocate an existing call', async () => {
  const gates = new ApprovalGates(100, 10);
  const waiting = gates.request(request);
  assert.throws(() => gates.request(request), /already exists/);
  gates.decide('run', 'call', 'approve');
  await waiting;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(gates.get('run', 'call'), undefined);
});
