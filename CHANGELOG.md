# Changelog

## Unreleased

### Data trust & account
- One-click workspace export: Settings → Workspace downloads a zip with every page as Markdown (wiki links intact — re-importable via Import ZIP), every database as CSV, and every notebook's source texts plus a `.bib`. The "export anytime" guarantee, made literal
- Account deletion (GDPR): self-serve in Settings → Workspace with type-to-confirm. Solely-owned workspaces are deleted with all content; shared workspaces keep everything (authorship references nulled); memberships, notifications, reviews and push subscriptions go with the account

### Billing ops
- Spend alerts from the gateway: workspace owners get a notification at 50/80/95% of the monthly USD cap (each threshold fires once per month) and a daily low-credit warning when prepaid balance drops under $2. E2E-verified against a live gateway loop

### QoL
- Quick capture: Ctrl/⌘-Shift-N anywhere in the app opens a tiny capture box — thoughts land timestamped in the Inbox page (created on first use), ready to triage later

### Agents (MCP)
- The native MCP server grew from 26 to 41 tools so external agents (Claude, Cursor, ChatGPT) get the full session feature set: `list_page_versions` / `get_page_version` / `restore_page_version`, `create_share_link` / `list_share_links` / `revoke_share_link`, `clip_web_page` (fetch any URL into a notebook as an indexed source), `clone_learning_path`, `list_quiz_attempts` / `grade_quiz_attempt`, `get_gradebook`, `get_audit_log` (type-filterable), `get_credit_balance` / `grant_credits` (owner), and `import_roster` (owner). Role and scope enforcement on each; destructive tools annotated
- Shared internals: invite logic extracted to `spaces/invite.ts`, gradebook CSV builder to `buildGradebookCsv`, `extractWebText` exported — HTTP and MCP paths now use the same code

### Billing (Phase 5, money path v1)
- Prepaid SET Cloud credits: Stripe Checkout sells $10/$20/$50 credit packs (products/prices created lazily by lookup key); `checkout.session.completed` webhooks credit the space ledger — signature-verified, idempotent by session id
- The gateway draws the balance down as it meters: each priced SET Cloud call appends a negative ledger row (exact token costs, 4-decimal cents); exhausted balance fails fast with a 429 pointing at Settings → Billing. Spaces that never bought credit keep the pure cap behavior
- Settings → Billing tab: balance, pack buttons (owner), manual grant/refund lever for support, full ledger history; purchases and grants land in the audit trail
- Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (documented in .env.example)

### Platform
- Single sign-on (OIDC): env-configured provider (OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET) adds a "Continue with…" button to the login page; authorization-code flow with state-cookie CSRF protection, discovery-document caching, and auto-provisioning of SSO-only accounts by email. Works with Google Workspace, Keycloak, Authentik, Auth0, Zitadel, …
- Self-host ops kit: `./scripts/ops/backup.sh` captures the Postgres dump + data volume into one timestamped archive; `./scripts/ops/restore.sh` puts it back (destructive, confirmed). Cron-friendly, documented in the README
- `GET /api/meta`: public instance metadata (version, SSO availability)

### Learning
- Assignment deadlines export to calendar: Learning Paths → My assignments → `.ics` (all-day events, RFC 5545)

### QoL
- Keyboard cheat sheet: press `?` anywhere in the app for the shortcut list (Ctrl+K palette, Esc, Cmd+Enter comments, `[[` links, `/` block menu)

### Research
- OCR for scanned PDFs: uploads with no text layer fall back to Firecrawl AnyDoc (`/v2/parse`) using the space's existing Firecrawl key (Settings → Deep Research) — scanned docs become clean markdown sources instead of empty chunks. Sources are tagged `OCR` (or `scanned` when no key is set, with a hint to configure one)

### Platform
- Web push notifications: Settings → Notifications enables device push for @mentions, comments and learning-path assignments (VAPID keys auto-generated per install; service worker focuses the right page on click). Dead endpoints are pruned automatically
- Workspace import: ZIP import now speaks Obsidian and Notion fluently — YAML front-matter is stripped (tags survive as hashtags), `![[image embeds]]` resolve to served files, note embeds become links, wiki links lose `.md`/`#heading` artifacts — plus a new Import ZIP button on the Pages list (previously the endpoint had no UI)

### Teams
- Course cloning: one-tap "Clone" on any learning path duplicates its items for the next cohort (assignments and due dates reset)
- Roster import: Settings → Members uploads a CSV (email column + optional role column) and invites everyone at once — existing users join instantly, the rest get invite emails; summary + audit event included

### Sharing
- Public read-only share links: publish any page to `/share/<token>` — no account needed to read. Create/revoke from a Share menu on the page (view counts and last-viewed tracked per link; revoked links dead-end immediately)

### Research
- BibTeX export: every notebook exports its sources as a `.bib` file (cite button in the notebook header) — LaTeX-special escaping, deterministic deduped keys, ready for Zotero/JabRef

### Teams
- Audit trail: the Activity feed gained a type filter (role changes, link publishes/revocations, web clips, gradebook exports, restores…) and a CSV export for compliance. Role changes are now recorded; gradebook exports and web clips are audited too

### Pages
- Page version history: every content save (human or agent) snapshots the prior state; a History tab in the page side panel lists versions with author + time, shows a line diff against the current page, and restores any version — restores are themselves undoable (last 50 kept per page)

### Research
- Web clipper: a bookmarklet (Settings → Clipper) saves any web page — or just your selection — from any site straight into the space's Clips notebook as an indexed, citable source. Personal `setclip_` tokens are hash-stored, shown once, rate-limited, and revocable anytime

### Learning / Teams
- Quiz integrity: quizzes can run as assessments — per-deck settings for question shuffle, option shuffle, time limit (server-enforced deadline + auto-submit), attempt caps, and bank draws (serve N of M questions). Attempts are server-side: correct answers never reach the browser mid-attempt, answers autosave, and abandoned attempts finalize on the next start
- Open-answer questions: quiz generation can mix in short-answer questions (with model-answer references) that editors grade manually per student with score + feedback
- Gradebook export (Learning Paths → Gradebook): CSV of members × quiz best-score % × path progress with overdue and at-risk flags, ready for LMS import
- Grading view for editors on every quiz deck: all attempts with scores, late flags, and inline open-answer grading

### Fixes
- `GET /spaces/:id/decks` crashed (`jsonb_array_length` on object-shaped items) for generated decks; item counts now handle every deck shape

## v2.1.0 (2026-08-23)

Initial open-source release.

### Core
- Pages: rich block editor (tables, images, highlights, strike/underline, slash menu, [[ autocomplete, YouTube embeds, block references), full Markdown round-trip + import/export
- Knowledge graph: bidirectional backlinks, unlinked mentions, force-directed graph view, daily notes, templates + template kits, ZIP workspace import (pages, images, CSV -> typed databases)
- Databases: table / kanban / calendar / gallery views
- Research notebooks: PDF/web/text sources, inspectable + editable chunks, grounded chat with citations, knowledge views (tree/timeline/index), flashcards/quizzes/study guides/audio overviews with spaced repetition
- Copilot: AG-UI streaming agent with tools, human-in-the-loop approvals, A2UI generative UI, user-designed mascot
- Teams: spaces + roles, assignments with deadlines, notifications (+ @mentions), comments, activity feed, My Tasks
- Command palette (Ctrl+K), PWA (installable, mobile-safe)

### Optional work surfaces
Coding (sandboxed JS runner), Terminal, 3D & CAD (GLB/STL/OBJ/URDF/STEP), Library (open-dataset imports), Learning Paths, Canvas

### Platform
Docker Compose self-host, BYOK LLM router (any OpenAI-compatible endpoint), optional RAGFlow retrieval, per-route auth rate limiting, password reset + optional SMTP, Postgres + Redis, AGPL-3.0
