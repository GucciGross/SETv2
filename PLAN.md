# SET v2 — Product Roadmap: Deep Research & Show-Me Teaching

Status: active · Owner: Gucci + SET copilot · Last updated: 2026-08-25

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

**Guardrails:** per-domain rate limit (default 1 req/2s), robots.txt respected,
max pages per run (default 40, configurable), full run log kept for transparency.

## Phase 2 — Show-me browser extension companion

Teach by demonstrating **in the user's own browser**, live.

- Chrome/Brave/Firefox extension (Manifest V3), installed deliberately
- Pairs with the user's SET instance via revocable pairing token (settings UI)
- Copilot gains `browser_show` tools: open page, scroll, point/highlight,
  walk-through steps — **foreground only, visible indicator, user can stop**
- Uses CDP/extension APIs locally; nothing runs server-side on the user's box
- Session recording optional (stored as a study artifact: "re-watch the demo")

**Done when:** "show me how to use regex101" demonstrates on regex101, live.

## Phase 3 — Desktop teaching companion (only after Phase 2 earns it)

cua-driver-style native automation for teaching desktop apps.

- Per-OS installer, OS accessibility permissions (macOS AX, Linux AT-SPI, Windows UIA)
- Explicit per-session consent (like screen sharing), always-visible action,
  hard off switch; never installed silently, never acts unfocused
- Scope-limited: teach/demonstrate workflows the user asks for
- Big surface — only build with Phase-2 usage data justifying it

---

## Explicitly out of scope

- Bot-detection evasion of any kind
- Headless/background control of user machines
- Scraping that ignores robots.txt or provider ToS
- Server-initiated access to a user's computer without a user-installed companion
