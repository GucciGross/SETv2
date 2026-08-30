# WandGx Builder — creation connector

SET stays the knowledge + learning layer; **WandGx** is the creation layer.
When the surface is enabled, any page (or the copilot, or an MCP client) can
start a **WandGx build** from a prompt. WandGx generates a real app — GitHub
repo, Docker setup, live URL — and the results land back on the page's
**Build log**. The natural pairing is the project-based-learning catalog
(`npm run import:pbl`): work a tutorial, then generate your own variant.

```
SET page / copilot / MCP ──POST /set/builds──▶ WandGx API
                                              (generates + deploys)
SET /api/wandgx/events ◀──HMAC webhook──────── WandGx
        └──▶ wandgx_builds row + page Build log + bus event
```

## SET side (this repo)

Enable per space: **Settings → Work surfaces → WandGx Builder**.

Server env (see `server/src/config.ts`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `WANDGX_URL` | `http://127.0.0.1:4001/api/v1` | WandGx API base (its dev port; prod `:4000` collides with SET) |
| `WANDGX_TOKEN` | – | Service credential. Empty = connector disabled |
| `WANDGX_WEBHOOK_SECRET` | – | HMAC key for inbound build events (or bearer fallback) |

Local test without a real WandGx:

```bash
npm run wandgx:stub                    # stub on :4101, fires the webhook back
WANDGX_URL=http://127.0.0.1:4101 WANDGX_TOKEN=stub-token \
WANDGX_WEBHOOK_SECRET=stub-secret npm run dev
npm run smoke:wandgx
```

## WandGx side — implementation contract

**1. `POST {WANDGX_URL}/set/builds`** (Bearer `WANDGX_TOKEN`), request:

```json
{ "title": "CHIP-8 starter", "prompt": "…",
  "source": { "app": "set", "spaceId": "…", "pageId": "…", "buildRowId": "…" } }
```

Reply `201`: `{ "projectId": "…", "buildId": "…", "status": "building" }`.
Failures: non-2xx with `{ "error": "…" }` — SET records the build as `error`.

**2. Webhook `POST {SET}/api/wandgx/events`** when the build finishes. Either
`Authorization: Bearer {WANDGX_WEBHOOK_SECRET}` or HMAC-SHA256 headers
(mirrors WandGx's own `setFeedbackAuth` scheme):

```
x-wandgx-signature: hex(hmac_sha256(secret, `${spaceId}.${timestamp}.${eventId}.${rawBody}`))
x-wandgx-timestamp: unix ms      # ±5 min skew enforced
x-wandgx-event-id:   unique id   # for replay detection on the sender side
```

Body:

```json
{ "spaceId": "…", "buildRowId": "…", "buildId": "…",
  "type": "build.deployed", "status": "deployed",
  "repoUrl": "https://github.com/…", "liveUrl": "https://…/app" }
```

`status`: `queued | building | deployed | error` (plus `error` text on
failure). Send `buildRowId` (from the `/set/builds` request) — it addresses
the row directly.

## Implementing the service side

Any app-generation service can back this connector by implementing two
things:

1. **`POST {WANDGX_URL}/set/builds`** (Bearer `WANDGX_TOKEN`) — create the
   project + build from `prompt`, kick the generator, and reply with ids
   (contract above). The service authenticates SET with the shared
   `WANDGX_TOKEN`.
2. **The webhook** — on build completion, POST the signed event to
   `{SET}/api/wandgx/events` (scheme above). Replay-safe by event id;
   `buildRowId` addresses the row directly.

For the hosted SET Cloud (WandGx) deployment, these endpoints and the
service credential are provisioned by the operator — nothing about the
service's internal auth belongs in this repo.
