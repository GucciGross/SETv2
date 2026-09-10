# Personal Codex for SET Copilot

SET uses the official Codex app server's managed ChatGPT device-code sign-in.
Being open source is not itself authorization to use subscription credentials.
Account eligibility, workspace policy and subscription usage limits still apply.
No copied OAuth client ID, external-token import or subscription-to-API proxy is implemented.

## Self-hosted setup

Use the explicit optional Docker target (single SET server replica):

```sh
docker compose -f docker-compose.yml -f docker-compose.codex.yml up -d --build
```

The override installs official `@openai/codex@0.154.0` inside the server image and sets:

```dotenv
SET_DEPLOYMENT_MODE=self-hosted
SET_CODEX_OAUTH_ENABLED=1
```

For a native Node deployment, install the same official CLI in the server environment.
`SET_CODEX_BIN` can specify its executable. Do not mount an operator's existing Codex home.
SET creates dedicated per-user homes in `DATA_DIR/codex-users` and private temporary working directories.
Both flags above must be explicit; missing values, unknown modes and `cloud` deny access.
The standard Docker image does not include the CLI; `docker-compose.cloud.yml` pins cloud mode and disables sign-in.
Never apply the self-hosted override to the hosted product.

Open **Settings**, find **Codex · Sign in with ChatGPT** beneath the workspace settings,
choose **Sign in with ChatGPT**, then open the displayed official verification page and enter the code.
Complete the account authorization there. SET polls status; it does not receive the account password.
Device-code sign-in may need enabling in ChatGPT security settings or by the workspace administrator.
After connecting, explicitly select **Use Codex for my Copilot**. Other members' providers are unchanged.
Disconnect stops the active connection, disables the selection and deletes that user's local Codex credentials.

## What it powers

Voice and text use the same `set_guide` conversation, screen context and SET tool engine.
Interactive Copilot requests can use the signed-in user's Codex account even without a workspace chat provider.
Background jobs, API/channel callers, embeddings, speech transcription and independent AI-generation tools
continue using their separately configured providers. A failed selected Codex connection does not silently
fall back to a metered API. Switch the preference off explicitly to use the workspace provider again.

The Codex turn exposes SET dynamic tools. SET still checks roles, requests configured human approvals,
executes and audits tool calls, and stops after rejected, expired or cancelled approvals. Codex receives
the verified tool result, not a fabricated success. Frontend tools continue through CopilotKit's existing
client handoff and next-run conversation history. Native Codex shell, filesystem, app/MCP, multi-agent and
web tools are not an alternate route around SET permissions.

## Operator/security boundaries

Credentials are private server files, not browser storage or workspace provider rows. The operator must
be trusted; protect the data volume and backups as credentials. User homes are mode 0700 and preferences
0600. Child processes receive an allowlisted environment, never SET's database/JWT/provider secrets.
Tool execution uses a read-only sandbox restricted to an empty private working directory. This is not a
claim of independent OS-user/container isolation against a malicious server operator.

The pool supports **one server replica**, at most eight active personal processes and one run per user.
Do not run several replicas sharing these homes: in-memory leases/approval gates are not distributed.
Idle processes close after five minutes; login and agent work have ten-minute bounds. RPC requests,
output, tools and argument sizes are bounded. No arbitrary RPC endpoint is exposed to the browser.

## Voice and interface

The large microphone/keyboard rocker sits above the compact existing mobile navigation. Desktop keeps
its full sidebar. The open chat has the same two controls, including an accessible Stop/Cancel mic action.
Text mode, closing chat, hiding the tab, changing workspace/user, and unmounting cancel recording/upload.
Microphone permission is requested only after a user action. HTTPS (or localhost) is required.

Server voice uses the existing `TRANSCRIBE_*` service with a 60-second, 8 MB upload limit. Without that
service, supported browsers can use speech recognition; browser recognition is **not guaranteed offline**.
Spoken replies use browser speech synthesis and can be muted. Codex sign-in does not supply an audio API key.

## Validation and remaining manual checks

CI covers the real CLI's unauthenticated initialize/account protocol, deterministic managed-login and
per-user lifecycle tests, native dynamic-tool handoff, shared-engine approvals and failure handling,
cloud route denial, bounded audio uploads, and actual-shell browser interactions with synthetic external
services. Browser artifacts include screenshots of the real controls, not a mock implementation.

No live ChatGPT account or paid inference request is used in CI. Before deployment, validate a real
account's device-code authorization, refresh, usage-limit handling and a tool-producing turn. Physical
iOS/Android microphone/keyboard behavior and speech quality require device checks.

Primary protocol reference: https://developers.openai.com/codex/app-server/
