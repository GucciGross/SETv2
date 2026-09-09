# Copilot approvals: one conversation, one exact action

## User contract

An approval appears inside the assistant message containing its tool call, in the
existing SET Copilot popup. It must never create a second approval surface behind
the chat. Closing and reopening the popup retains the pending card; starting a
new chat or changing account/workspace must not transfer decisions to another
conversation. Approve and Deny have at least 44px-high touch targets. Action
arguments are available through an accessible disclosure instead of dominating
the conversation.

Pending, submitting, approved, rejected, expired, cancelled and unavailable are
separate states. Only an explicit Deny means rejection. A timeout is not rejection
and an approval is not execution success. Network errors stay visible; retries
refer to the same tool call. The UI can recover a lost POST acknowledgement by
reading the authenticated receipt. Actual tool failures must not render success
cards.

## Shared engine and API contract

`server/src/agents/approvals.ts` is the single approval registry used by the agent
engine and REST endpoints. It registers a gate before emitting its event, keys it
by server run ID plus call ID, expires it after three minutes and retains terminal
receipts for five minutes for idempotent retries. Cancellation removes listeners
and settles the gate without executing the action. A restart loses in-memory
pending gates and fails closed; this is not a distributed durable-workflow engine.

The engine assigns unique tool-call IDs before publishing the tool declaration,
including when a provider reuses its IDs. Model history, stream events, receipts
and results all use those same IDs. Request flags can strengthen but cannot
weaken an enabled workspace approval policy. Current workspace write permission
is rechecked immediately before a server write, including after approval.

- `POST /api/agent/runs/:id/approve` requires `{ callId, decision }`, where decision
  is `approve` or `reject`. The authenticated run owner must still have editor
  access. A matching terminal retry is safe. Missing call IDs fail with 400;
  stale, contradictory, expired or cancelled decisions fail with 409.
- `GET /api/agent/runs/:id/approvals/:callId` returns the caller's current receipt
  without caching. It does not expose action arguments or another user's runs.
- `approval_request` carries `threadId`, `spaceId`, `runId`, `callId`, `tool`,
  `args`, `expiresAt` and `status` in an AG-UI CUSTOM event.
- `approval_resolved` carries the same scope and terminal status. Audit records in
  `agent_runs.tool_log` persist the requested and resolved timestamps and status.

A denial, timeout, cancellation or revoked write permission stops the remaining
batch. The engine resolves skipped tool calls without executing them and does
not ask the model to find another route around the decision. This includes
frontend writes such as `insert_into_editor` after an H5P refusal. Existing
frontend tool approval/confirmation rules remain in place; this change does not
classify every frontend tool as a server write.

The legacy SSE endpoint and the CopilotKit bridge propagate client disconnects
into cancellation. No blanket auto-approval or bypass setting is introduced.

## H5P and workspace quality improvements

H5P draft/save/publish results link to the actual activity in the current
workspace. Empty drafts explicitly say they are not playable. Failed, rejected
and unfinished tools no longer show misleading creation/readiness cards.
Navigation recognizes H5P Studio and individual activities, and screen context
names them correctly. Copilot instances reset on account/workspace changes.
Database-backed conversations exclude the newly inserted empty run when loading
prior history. Page/notebook context reads are scoped to the active workspace.

## Verification and operations

`cd server && npm test` covers exact-call approval, replay, timeout, abort,
revocation, workspace policy, batch-stop behavior and authenticated HTTP routes.
`cd web && npm test` covers approval reducer states, stale responses, malformed
scope and safe H5P routing. Standard API smoke tests include the fail-closed
approval endpoint contract.

`web/scripts/copilot-approval-smoke.py` runs the real SET GuideFab, CopilotKit
popup, assistant message slots and H5P result renderers at phone and desktop
widths. A deterministic AG-UI agent and decision endpoint replace only network
nondeterminism. The test covers inline placement, replay, close/reopen, double
taps, denial, retry, expiry, stop and readiness labels. Its fixture lives outside
the production entry graph. This is not a live paid-provider test or a claim of
native Safari certification. CI retains screenshots for review, and existing
real H5P HTTP/HTTPS deployment tests remain enabled.

Deploy server and web together, then refresh cached clients. Old clients that
omit `callId` intentionally cannot approve an unspecified action. No database
migration is required. Multi-replica pending approvals still require a shared
broker/receipt store before load-balanced operation can be claimed.
