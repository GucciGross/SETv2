# SET v2 — Product Roadmap: Deep Research & Show-Me Teaching

Status: active · Owner: Gucci + SET copilot · Last updated: 2026-08-26

---

## Principles (non-negotiable)

1. **No detection evasion — ever.** We do not build fingerprint spoofing, captcha
   bypass, or stealth tooling. Web access goes through legitimate APIs
   (Firecrawl/Tavily/Brave), with polite rate limits, caching, and robots.txt
   respect. When a site walls us off, the research run says so in the report.
2. **Visible action only.** The teaching agent never acts headless or in the
   background. When it drives a browser, the user watches every action on
   their own screen, with a visible indicator — like a human teacher sitting
   next to them.
3. **Consent-shaped control.** Any browser/desktop control is installed
   deliberately by the user, paired to their own instance with a revocable
   token, and can be killed at any moment.
4. **Outputs are SET artifacts.** Research lands in notebooks/pages with real
   citations — searchable, chat-able, flashcard-able — not chat blobs.

---

## Phase 0 — Copilot chat SSE path — ✅ RESOLVED (not an app bug)

**What we chased:** chat replies that appeared with zero server-side runs,
`create_notebook` "successes" with notebook IDs that didn't exist in the DB,
transcripts that accumulated across fresh browser sessions.

**Root cause:** the QA harness itself. It orphaned headless Chromium processes
on every run (`terminate()` killed only the launcher parent; Chrome forks).
Screenshots and CDP connections from later runs were contaminated by long-lived
orphan pages that accumulated stale chat state — the "ghost" was our own
leftover browser. Verified by killing all orphans: the popup then behaved
honestly (no fabricated replies; pending spinner; no server run).

**Evidence the app path is healthy:**
- Real user chats produce `agent_runs` rows + real DB writes (e.g. the
  "Green Bay Packers" notebook, run row 5d90bce9).
- Direct engine E2E (POST /agent/run) creates notebooks for real.
- Server now logs `[copilotkit] <method> <path>` per runtime request plus
  `[set-agent]`/`[engine]` entry lines — permanent observability for this path.

**Known QA-harness limitation (not an app bug):** in headless Chromium, the
CopilotPopup's submit (Enter or send button) doesn't dispatch a run — works on
real devices. Full GUI chat-loop testing needs a headed browser or a fix in
synthetic-event delivery; tracked as a harness TODO, not product work.

---

## Phase 1 — Deep Research v1  · next

A long-running research job (not a chat turn) that produces a cited notebook.

**Architecture:**

```
User question (notebook or dashboard)
   │
   ▼
[Planner agent]  → research outline: sub-questions, source-quality bar
   │
   ▼
[Research loop]  (background job, 50+ steps allowed)
   │   search web (Firecrawl) → select → fetch as markdown
   │   → ingest each page as a notebook SOURCE (chunks + citations)
   │   → re-plan: what's still unanswered? → more searches
   ▼
[Synthesizer]  → report page with [[wiki links]], every claim cites a chunk
   │
   ▼
Notebook: sources indexed · report page · study deck auto-available
```

**Why this shape:** writing results into the existing `sources`/`chunks`
pipeline makes `search_knowledge`, citations, and study-material generation
work on research output for free.

**Job model:** `research_runs` table (status, outline, sources_found, log);
runs execute in-process with a small worker queue; progress streams to the UI
via SSE/WebSocket (same pattern as presence). UI: progress timeline
(planning → searching 12/30 → reading → writing) + cancel button.

**Server work:**
- `server/src/research/` — planner/worker/synthesizer + `research_runs` table
- Firecrawl client (`firecrawl_search`, `scrape` → markdown) + plain-fetch fallback
- Settings: BYOK providers UI (like AI providers), incl. self-hosted Firecrawl URL

**Web work:**
- "Deep research" action in NotebookView + dashboard
- ResearchRunView: live outline, sources streaming in, final report

**Self-hosted fetch stack (no cloud keys):** SearXNG (search) + real Chrome
over raw CDP (`chromedp/headless-shell`, the browser-harness pattern — no
Playwright in the primary path; optional Playwright/Firecrawl-compatible
fallbacks via env/settings). Extraction: trafilatura with a crude-text
last resort, including open shadow-root content.

**Report styles & visuals:** Simplified Technical English is the default style;
professional / executive / study-notes styles and per-workspace custom
templates (Settings → Deep Research) are selectable at launch. Reports include
charts (`set:chart` specs rendered server-side), markdown comparison tables,
and a sourced picture gallery. Finished runs generate flashcard/quiz decks in
one click from their ingested sources.

**Run limits:** time limit is user-set — 5 minute minimum, 25 minute default,
up to 72 hours for deep multi-day runs (rounds scale with budget). Reports are
written in Simplified Technical English (ASD-STE100 style: short active
sentences, plain words, concrete facts, citations preserved); existing reports
can be re-written on demand via the run view's "Plain-English rewrite" button.

**Model requirement:** the crew loops on tool calls — use a tool-calling-capable
chat model. Spaces can set a research-only model in Settings → Deep Research
(`chatModel` override) without changing the copilot's default. Vision-tuned or
weak-function-calling models produce malformed tool args and stall runs.

**Guardrails:** per-domain rate limit (default 1 req/2s), robots.txt respected,
max pages per run (default 40, configurable), full run log kept for transparency.

## Phase 2 — Show-me teaching companion (browser-harness + cua) · *v1 slice live*

Teach by demonstrating **in the user's own browser/desktop**, live. The
companion stack (user-installed, always-visible, revocable):

- **browser-harness** (github.com/browser-use/browser-harness) — attaches the
  SET copilot to the user's real browser over a single CDP websocket: real
  logins, real profile, self-healing helpers the agent writes itself
- **cua-driver** (github.com/trycua/cua) — native-app teaching beyond the
  browser via OS accessibility (macOS AX / Linux AT-SPI / Windows UIA);
  the same driver we already use for SET's own GUI QA
- Platform harnesses as they mature: windows-harness, macos-harness,
  browser-harness-tui (operator view), and video-use (agents that can watch
  and reason over video — lecture capture as a source)
- Pairing: deliberate install + revocable token against the user's own
  instance; foreground only, visible indicator, hard stop; never silent

**Shipped (v1):** pairing tokens (Settings → Companion, revocable), teach-task
queue, `demo_on_screen` copilot tool, and the local companion agent
(`companion/` — uv, attaches to the user's real Chrome over CDP; visible
navigate + highlight + caption only, no clicks/edits/background). Verified
E2E. **Next:** external-site demos, narration audio, cua-driver for native apps.

## Phase 3 — Desktop teaching companion · *v1 live (Linux)*

cua-driver native automation for teaching desktop apps — same companion, new
task kind: launch a native app, find the element in the OS accessibility tree,
glide the visible agent cursor onto it, caption via desktop notification.
Copilot tool: `demo_native_app`. Visible actions only — never clicks or edits.
**Verified E2E** on Nemo (GTK/AT-SPI); requires the user to run `cua-driver
serve` on their machine. Original scope notes:

- Per-OS installer, OS accessibility permissions (macOS AX, Linux AT-SPI, Windows UIA)
- Explicit per-session consent (like screen sharing), always-visible action,
  hard off switch; never installed silently, never acts unfocused
- Scope-limited: teach/demonstrate workflows the user asks for
- Big surface — only build with Phase-2 usage data justifying it

## Phase 4 — Agent computer use · *live (Linux)*

The copilot sees and (with explicit opt-in) drives native desktop apps through
the user's companion + cua-driver: `screen_capture` (annotated element index +
screenshot with vision routing), `screen_act` (click/type/key/scroll, each
followed by a fresh capture), layered consent (observe-only by default;
`SET_ALLOW_INPUT=1` per machine; revocable pairing; workspace-level approval
gate). Follow-ups shipped 2026-08-26: capture history gallery (every persisted
screenshot = reviewable activity log), companion doctor (`--doctor`) +
heartbeat surfaced in Settings → Companion, and multi-window targeting notes
(ambiguous titles list candidate window_ids; silent fallback-to-newest is
called out so the model never mistakes one window for another).

## Phase 5 — Hosted cloud + LLM proxy billing · *design (next)*

The self-host core is stable; the money path is a hosted control plane where
users don't run Docker and don't bring keys. Same images, new surroundings:

```
Hosted SET (multi-tenant: spaces + memberships + JWT already isolate data)
   │
   ├── Signup/billing (Stripe) ── free tier → Pro (metered) → Team
   │
   ├── LLM gateway (the only cloud component users touch)
   │     · platform provider row "SET Cloud" in the existing BYOK settings UI
   │     · holds real upstream keys; per-space token metering + spend caps
   │     · rate limits + hard cutoff at cap; BYOK rows keep working unchanged
   │
   └── Usage metering: gateway logs (space, model, tokens) → usage table
         → Stripe metered billing; dashboard shows spend vs. cap
```

**Why this shape:** the server already routes all model calls through
`llm/router.ts` with per-space providers — a hosted default provider is one
row, not a rewrite. Spaces/memberships/`requireSpace` already give tenant
isolation in one Postgres. The companion pairs with any `SET_URL`, so hosted
users get computer use unchanged (still opt-in, still revocable).

**Principles carried over:** hosted ≠ snooping — computer use stays opt-in
per machine; capture history gets a retention setting (auto-delete after N
days, default short); BYOK always remains the escape hatch (a space can point
at its own endpoint and bypass billing entirely).

**Build order:** (1) gateway as a thin OpenAI-compatible proxy + usage table,
platform provider seeded per space; (2) Stripe checkout + portal, spend caps
in Settings; (3) hosted deploy (compose unchanged + TLS + backups); (4)
retention controls for captures. Open questions: region choice, model
passthrough pricing vs. margin, team-tier seat math.

---

## Explicitly out of scope

- Bot-detection evasion of any kind
- Headless/background control of user machines
- Scraping that ignores robots.txt or provider ToS
- Server-initiated access to a user's computer without a user-installed companion
