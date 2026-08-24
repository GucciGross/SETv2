# SCOPE — MCP (Model Context Protocol) for SET

Status: DRAFT — awaiting approval
Spec target: MCP 2025-11-25 (Streamable HTTP transport, JSON-RPC 2.0)

## 1. Goals

- Expose SET's full workspace API surface as first-class MCP tools, resources and prompts so any MCP client (Claude, ChatGPT, Cursor, Claude Code, custom agents) can operate a SET workspace natively.
- Ship review-ready for the Anthropic Connectors Directory and OpenAI ChatGPT Apps directory (naming, descriptions, annotations, icons, OAuth).
- Management, analytics and logging parity with our API: an operator can see every connected client, token, tool call, latency and error rate.
- A dedicated landing page for agentic visitors with copy-paste runtime setup (one URL + OAuth).

## 2. Architecture

- **Transport**: Streamable HTTP at `POST /api/mcp` (single endpoint; responds JSON or SSE per request; `MCP-Protocol-Version` header respected; 202/405 semantics for GET per spec). No legacy HTTP+SSE.
- **Server**: embedded in the existing Fastify server (no extra service, no extra deploy step for self-hosters). Version advertised: `2.1.0`.
- **Protocol methods**: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`, `logging/setLevel` (accepted), `completion/complete` (accepted minimal).
- **Capabilities** advertises: `tools: { listChanged: false }`, `resources: { subscribe: false, listChanged: false }`, `prompts: { listChanged: false }`, `logging: {}`.

## 3. Authentication (OAuth 2.1, closest to our stack)

Our existing stack = JWT bearer + bcrypt users. The closest OAuth implementation is making SET a **first-party OAuth 2.1 authorization server** that issues its own tokens against the same users table:

- `GET /.well-known/oauth-authorization-server` — AS metadata (issuer, endpoints, scopes, code_challenge_methods S256).
- `GET /.well-known/oauth-protected-resource` — RFC 9728 metadata pointing at the AS (what MCP clients fetch first).
- `POST /oauth/register` — RFC 7591 Dynamic Client Registration (public clients; returns client_id). Required by spec-round clients like Claude.
- `GET /oauth/authorize` — authorization-code endpoint with mandatory **PKCE (S256)**. Renders a consent screen styled identically to our login/register pages (same gradient background, same `set-card` panel, same fonts/palette): shows the requesting client name, requested scopes, workspace picker (which space to grant), Approve / Deny.
- `POST /oauth/token` — exchanges code (+ PKCE verifier) for an access token; refresh tokens with 30-day rotation.
- Tokens: signed JWTs with `sub` (user), `space` (granted workspace), `scope` (e.g. `mcp:read mcp:write`), `client_id`, `jti`; stored (hashed) in a new `mcp_tokens` table so operators can revoke.
- The MCP endpoint validates tokens (Bearer), checks space membership + role per call, and enforces scopes: read tools require `mcp:read`, write tools require `mcp:write`.

## 4. Tools (feature parity with the API)

All names snake_case, ≤64 chars, with `title`, end-user `description`, full JSON-Schema input (required, enums, per-param descriptions) and **annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: false`) — per store review requirements.

Read tools (`mcp:read`):
| Tool | API equivalent |
|---|---|
| `search_workspace` | GET /spaces/:id/search |
| `list_pages` | GET /spaces/:id/pages |
| `read_page` | GET /pages/:id (by id or title) |
| `read_page_backlinks` | GET /pages/:id/backlinks + mentions |
| `list_databases` / `query_database` | GET /databases/:id (rows+schema) |
| `list_notebooks` / `list_sources` | GET /notebooks/:id |
| `search_knowledge` | POST /notebooks/:id/search (hybrid retrieval, cited excerpts) |
| `list_study_decks` / `get_deck` | GET /decks |
| `list_my_tasks` | GET /spaces/:id/mytasks |
| `list_activity` | GET /spaces/:id/activity |
| `list_notifications` | GET /notifications |
| `list_models_3d` | GET /spaces/:id/models |

Write tools (`mcp:write`):
| Tool | API equivalent |
|---|---|
| `create_page` | POST /pages |
| `append_to_page` | append semantics of PATCH /pages/:id |
| `update_page_properties` | PATCH title/icon |
| `create_comment` | POST /pages/:id/comments (@mentions fire notifications) |
| `create_database_row` | POST /databases/:id/rows |
| `update_database_row` | PATCH /rows/:id |
| `create_notebook` / `add_notebook_source` | POST /notebooks, /notebooks/:id/sources (text) |
| `generate_study_material` | POST /notebooks/:id/generate |
| `import_from_dataset` | Library import (mesh/doc into space) |
| `create_page_template` | POST /spaces/:id/templates |

Every write tool mirrors the API's permission rules (viewer = 403) and surface gates (e.g. `import_from_dataset` requires the Library surface).

## 5. Resources & Prompts

- **Resources** (`mcp:read`): `set://pages/{id}` (Markdown), `set://notebooks/{id}/sources` (index), `set://mytasks` — so clients that prefer context loading over tool calls still get parity.
- **Prompts**: `set/daily-brief` (my tasks + due paths + unread notifications → digest), `set/research-brief` (grounded Q&A over a notebook), `set/page-outline` (structured page skeleton) — each with documented args.

## 6. Management, analytics, logs (parity with API surface)

New tables: `mcp_clients` (registered clients), `mcp_tokens` (hashed tokens, scopes, status), `mcp_calls` (every tools/call: tool, client, user, space, ok, duration_ms, error, created_at).

- **Settings → MCP tab** (styled like existing tabs):
  - Connected clients + active tokens: name, scopes, last used, revoke button.
  - Analytics: calls per tool (7d), success rate, p50/p95 latency, top clients — SQL-computed, charted with simple bars (no new deps).
  - Logs: recent 200 calls with expandable error bodies; filter by tool/client/status.
  - Server info card: endpoint URL, well-known URLs, spec version — copy-paste block for clients.
- `GET /api/spaces/:id/mcp/stats` and `/mcp/logs` back the UI (owner role).

## 7. Landing page for agentic visitors

`/agents` — public page in the existing landing design system (same header/footer/palette):
- Hero: "Give your agents a workspace." One-line value prop.
- **Quickstart block**: the MCP URL (`https://your-set/api/mcp`), Claude Desktop / Cursor / Claude Code / generic client JSON snippets, OAuth flow explanation.
- Tool catalog with per-tool doc cards.
- Links: docs, GitHub, self-host vs cloud (existing hosting section), llm.wandgx.com.
- Main landing gains an "Agents & MCP" pillar/CTA linking to `/agents`.

## 8. Documentation

- Docs site gains an **"MCP & Agents"** section with: overview, auth flow diagram (text), quickstarts per client, and **a self-contained doc block for every tool** (name, description, scopes, full input schema table, output shape, examples, errors, rate/surface notes) — mirroring API-doc depth.
- `/api/mcp/docs.json` — machine-readable tool manifest (for stores/review materials).

## 9. Store-readiness checklist (baked into implementation)

Anthropic directory: tool names ≤64 chars snake_case ✓, end-user descriptions ✓, titles + annotations ✓, square SVG logo (`web/public/mcp-icon.svg` + PNG exports) ✓, stable OAuth ✓, privacy/ToS links ✓ (docs pages), accurate tool behavior vs descriptions ✓.
OpenAI apps: MCP server URL stable ✓, OAuth complete (incl. dynamic registration) ✓, review materials (docs.json + test script `mcp-review.md`) ✓, availability metadata documented ✓.
Both: no tool description overflow, no undocumented side effects, destructive tools annotated, all tools tested.

## 10. Tests (parity with API smoke suite)

- Protocol: initialize handshake (protocolVersion negotiation), unknown-method error, ping, tools/list shape (names/descriptions/annotations present), resources/list, prompts/get.
- Auth: well-known metadata endpoints, dynamic client registration, full OAuth code+PKCE flow (reject wrong verifier), token refresh, revoked token 401, missing scope 403, expired code.
- Tools: happy path + permission path for ≥8 representative tools (search_workspace, read_page, create_page, append_to_page, create_comment, search_knowledge, create_database_row, list_my_tasks), viewer-role 403, invalid-args JSON-RPC error shape, tools/call timing recorded in mcp_calls.
- Runs as `node mcp-smoke.mjs` in CI alongside the API smoke suite.

## 11. Out of scope (explicitly)

- Legacy HTTP+SSE transport; WebSocket transport.
- OAuth scopes per-tool granularity (read/write split only for v1).
- MCP sampling/roots/server-initiated requests (client→server only).
- Billing integration for MCP usage.

## 12. Deliverables checklist

- [ ] server: MCP endpoint + protocol layer
- [ ] server: OAuth 2.1 (metadata, DCR, authorize consent page, token, refresh, revoke)
- [ ] server: 23 tools + 3 resources + 3 prompts with store-grade metadata
- [ ] server: mcp_clients/mcp_tokens/mcp_calls + stats/logs routes
- [ ] web: consent page (login-styled), Settings→MCP tab, /agents landing, docs section, icons
- [ ] mcp-smoke.mjs + CI wiring + full local verification + push with green CI
