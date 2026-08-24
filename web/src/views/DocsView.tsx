import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { marked } from 'marked';
import { BookOpen, X, Menu } from 'lucide-react';

/**
 * SET documentation — teaches what SET is and how to use every feature.
 * Served publicly at /docs (no account needed) and inside the app.
 */

interface DocSection {
  id: string;
  title: string;
  md: string;
}

const md = (s: string) => ({ __html: marked.parse(s, { async: false }) as string });

const SECTIONS: DocSection[] = [
  {
    id: 'what-is-set',
    title: 'What is SET?',
    md: `
**SET (Strategic Enablement Toolkit)** is an open-source, self-hostable **Knowledge + Learning Operating System**: structured documents and databases, a connected knowledge graph, grounded AI research over your own sources, and an agent copilot — in one coherent product.

- **Structured workspace** — hierarchical pages, rich block editor, relational databases, team spaces
- **Connected knowledge graph** — local-first Markdown ownership, \`[[wiki links]]\`, backlinks, graph view
- **Grounded AI research** — source-grounded AI chat with citations, study-material generation
- **An AI copilot** that can actually *do things* in your workspace, with a mascot you design
- **Optional work surfaces** — Coding, Terminal, 3D & CAD, an open-dataset Library, Learning Paths, Canvas

**Core principles:** you own your data (plain files + your Postgres), bring your own LLM (local Ollama or any OpenAI-compatible API), everything is Docker-deployable, and niche power features are opt-in toggles — not clutter.

Self-hosting is free forever (AGPL-3.0). Prefer zero setup? A cheap **hosted SET cloud** is coming — join the waitlist on the [landing page](/). A hosted LLM API is available today at [llm.wandgx.com](https://llm.wandgx.com).
`,
  },
  {
    id: 'quick-start',
    title: 'Quick start',
    md: `
### Self-host (Docker)

\`\`\`bash
cp .env.example .env         # set JWT_SECRET for production
docker compose up -d
open http://localhost:8080
\`\`\`

Register the first account — you get a personal vault automatically. Seed a demo workspace with \`SEED_DEMO=1 docker compose up -d\` (login: \`demo@set.local\` / \`demo-demo\`).

### Local development

\`\`\`bash
docker compose up -d db redis     # Postgres + Redis
cd server && npm install && npm run dev    # API on :4000
cd web && npm install && npm run dev       # UI on :5173
\`\`\`

### Install on your phone (PWA)

1. Open the server URL in your phone browser (iOS requires **https** — run \`HTTPS_DEV=1 npm run dev\` for the dev server and accept the self-signed certificate once).
2. Sign in, then use **Share → Add to Home Screen**.
3. Launch from the home screen: SET runs full-screen like a native app — no browser chrome, notch-safe layout, in-app downloads.

### Your first five minutes

1. Click **Page** in the sidebar and start writing. Type \`[[\` to link pages, \`/\` for the block menu.
2. Press **Today** for a daily journal note.
3. Open **Graph** to watch your knowledge graph grow as you link.
4. Create a **Notebook**, drop in a PDF, and ask questions with citations.
5. Enable **Work surfaces** in Settings for Coding, Terminal, 3D, and the Library.
`,
  },
  {
    id: 'pages',
    title: 'Pages & the editor',
    md: `
Pages are hierarchical documents written in a rich block editor. Everything round-trips to **Markdown** — export any page (or the whole space) at any time.

### Writing

- **Formatting** — bold, italic, underline, ~~strikethrough~~, ==highlight==, inline code, links. All from the toolbar or shortcuts.
- **Slash menu** — type \`/\` at the start of a line for headings, lists, task lists, tables, code blocks, quotes, dividers, images, YouTube videos, wiki links and block references.
- **Tables** — insert via \`/table\`; use the floating control bar to add/remove rows and columns; column alignment survives Markdown round-trips.
- **Images** — paste or drag a file straight into the page; it uploads automatically. \`/image\` opens a picker.
- **Video** — \`/video\` or the YouTube button embeds tutorials and lectures directly in notes.
- **Code blocks** — with language tags.

### Linking your thinking

- **Wiki links** — type \`[[\` for an autocomplete of page titles; pick an existing page or create a new one on the fly. Links work even before the target page exists (forward links resolve automatically).
- **Backlinks** — every page shows who links *to* it and what it links to, in the right panel.
- **Unlinked mentions** — SET finds pages that *mention* the title in plain text but don't link yet. One click away from becoming links.
- **Block references** — the toolbar's **Copy block id** stamps a permanent ID on any paragraph or heading. Embed it anywhere with \`((id))\` or \`/block reference\`; the embed shows the live source text and links back.

### Organization

- **Sub-pages** — hover any page in the sidebar for *add subpage*; drag-free hierarchy.
- **Daily notes** — the **Today** button creates or opens today's journal. Set a template in Settings → Workspace.
- **Templates** — save any page as a template; create pages from it.
- **Import/Export** — import folders of \`.md\` files (front-matter aware); export a page or the entire space as Markdown.
- **Trash** — deleted pages rest in the sidebar trash until restored.
`,
  },
  {
    id: 'graph',
    title: 'Knowledge graph',
    md: `
The **Graph** view renders every page as a node and every wiki link as an edge, laid out with a force simulation.

- **Drag** nodes to rearrange, **scroll** to zoom, **double-click** a node to open the page
- **Filter** box focuses a page plus its one-hop neighborhood
- Node size reflects how connected a page is; daily notes are amber
- **Canvas (beta)** — an optional work surface that lays your pages out on an infinite pannable board with edges drawn from wiki links. Enable it in Settings → Work surfaces.
`,
  },
  {
    id: 'databases',
    title: 'Databases',
    md: `
Databases are structured collections where **every row is also a page** — click a row's title to open and write its full page.

### Columns
Text, number, select, multi-select, date, checkbox, person, URL. Configure options and colors for selects.

### Four views (plus more per database)
- **Table** — spreadsheet grid with inline editing
- **Board** — kanban grouped by any select column; drag cards between columns
- **Calendar** — month grid fed by any date column
- **Gallery** — card grid with cover art

### How to use
1. Sidebar **Databases → +** or create from a page.
2. Add rows with **New** — a page is created automatically.
3. Switch views with the tabs; add more views anytime.
`,
  },
  {
    id: 'notebooks',
    title: 'Research notebooks',
    md: `
Notebooks are citation-grade research grounded in *your* sources.

### Adding sources
Upload **PDFs, Markdown, text**, paste transcripts, or fetch **web pages** by URL. (Self-hosters can also bulk-import from open datasets via the Library surface.) Sources are parsed and chunked along headings with page tracking.

### Grounded chat
Ask anything — answers stream with inline citations \`[1] [2]\`. Click a citation chip to read the exact source chunk. Answers are constrained to your sources; if the answer isn't there, it says so.

### Inspect and correct the index
The **Chunks** tab shows exactly how each source was split. Edit any chunk (typo fixes, boundary changes) and re-embed it — human-in-the-loop retrieval.

### Knowledge views
The **Knowledge views** tab compiles your sources into browsable structures: a mind-map tree of sections, a timeline of every date found, and a page index.

### Study materials
The **Study** tab generates from your sources:
- **Flashcards** with spaced repetition (Again / Hard / Good / Easy)
- **Quizzes** with explanations
- **Study guides** in Markdown
- **Audio overviews** — a two-host script playable in the browser

All generation uses your configured LLM; search and indexing work even with none.
`,
  },
  {
    id: 'copilot',
    title: 'The copilot & your mascot',
    md: `
The copilot is a real agent, not a chatbot. It streams over an AG-UI-style protocol and can call tools that change your workspace:

- \`search_workspace\` / \`read_page\` — find and read your content
- \`create_page\` / \`append_to_page\` — write into your vault (with wiki links)
- \`search_knowledge\` — grounded retrieval from notebooks with citations
- \`generate_study_material\` — flashcards, quizzes, study guides, audio
- \`open_3d_model\` — put interactive 3D into the chat
- \`render_ui\` — rich A2UI components (cards, tables, forms) rendered natively in the panel

**Try:** *"Summarize this page"*, *"Create a page about X linking to Y"*, *"Quiz me on the notebook"*, *"Import CAD task briefs from the library"*.

### Human-in-the-loop
Enable **approval mode** in Settings → Workspace and every write action pauses for your Approve/Reject before touching your data.

### Your mascot
Settings → **Mascot** designs your desk pet: species, colors, eyes, accessories, name — plus a Randomize dice. It lives in the copilot header everywhere you sign in, blinking while idle, bouncing while the agent talks, and celebrating finished runs. (Mascot concept inspired by the Apache-2.0 OpenMausBot project.)
`,
  },
  {
    id: 'surfaces',
    title: 'Work surfaces',
    md: `
SET ships a **complete knowledge core** (pages, graph, databases, notebooks, copilot). Everything else is an optional surface toggled per space in **Settings → Work surfaces** — so CAD enthusiasts get their tools and everyone else gets a clean app.

| Surface | What it adds |
|---|---|
| **Coding** (on by default) | Code files with an editor and a sandboxed JavaScript runner (no fs/network, 3s timeout) |
| **Terminal** (on by default) | Workspace console: \`pages\`, \`open\`, \`find\` (grounded search), \`new\`, \`runjs\`, \`surfaces\` |
| **Learning Paths** | Ordered curricula you assign to members with deadlines and progress bars |
| **3D & CAD** | GLB/GLTF viewer with explode + clickable parts, STL/OBJ meshes, URDF robots with animated joints, STEP import (OpenCascade WASM), part-to-page links |
| **Library** | Browse curated open datasets (HuggingFace) and import files: meshes → 3D viewer, documents/parquet → notebooks, rest → files |
| **Canvas** | Experimental infinite-canvas spatial view over your pages |

Surfaces are enforced server-side too — a disabled surface's API returns a friendly 403.
`,
  },
  {
    id: 'teams',
    title: 'Teams & training',
    md: `
SET is built for small teams learning together — two friends shipping a game, or a boss onboarding crew members.

### Spaces & roles
Personal vaults + team spaces. Invite members by email as **editor** or **viewer**; owners manage everything.

### Assignments & deadlines
On any Learning Path: **Assign** members, set a due date, save. Each member gets a **My assignments** section with progress bars and overdue highlighting; owners see per-member completion in the path's team progress panel.

### Notifications
The bell shows assignments, synthesized **due-soon** reminders (within 7 days), and comment activity — with unread counts and mark-all-read.

### Comments & @mentions
Every page has a collapsible comment thread (Ctrl/Cmd+Enter to post). Type @Name to mention a teammate — they get a mention notification (highlighted in the thread). Page owners and fellow commenters get notified about activity.

### My Tasks
The **My Tasks** view (sidebar) gathers everything on your plate into one list: assigned learning paths with due dates and progress, plus every open checkbox task found across the space's pages. Checking a task off in My Tasks completes it in the source page instantly.

### Template kits
Settings → Workspace → **Export kit** downloads all your templates as a shareable JSON file; **Import kit** clones them into any other space — perfect for rolling out a standard onboarding pack across teams.

### A new-hire playbook
1. Boss creates an "Onboarding" path from company pages/docs notebooks.
2. Assigns it with a deadline; employee gets notified.
3. Employee reads, comments, asks the grounded copilot about the SOPs.
4. Boss watches the progress bar hit 100%.

New tool at the company? Upload the manual as a source, generate a quiz, assign it. Done.
`,
  },
  {
    id: 'llm',
    title: 'LLM providers (BYOK)',
    md: `
Bring your own key — any **OpenAI-compatible** endpoint works. Settings → **AI Providers**:

| Field | Example |
|---|---|
| Base URL | \`http://host.docker.internal:11434/v1\` (Ollama) · \`https://api.z.ai/api/coding/paas/v4\` (Z.AI) · \`https://api.openai.com/v1\` |
| API key | usually not needed for local runtimes |
| Chat model | \`llama3.1\`, \`glm-5v-turbo\`, \`gpt-4o-mini\`, … |
| Embedding model | \`nomic-embed-text\` (optional) |

Presets for Ollama, LM Studio, vLLM, OpenAI, OpenRouter and Grok are one click away. **Test** verifies the connection instantly.

Without an embedding model, retrieval uses a built-in deterministic index — search works with zero LLM. Chat and generation need a provider. You can also bootstrap one via env vars (\`LLM_BASE_URL\`, \`LLM_API_KEY\`, \`LLM_CHAT_MODEL\`, \`LLM_EMBED_MODEL\`).
`,
  },
  {
    id: 'self-hosting',
    title: 'Self-hosting & data',
    md: `
### Docker Compose services
- **db** — Postgres 16 (+pgvector, optional)
- **redis** — presence & live-sync pub/sub (in-memory fallback if absent)
- **server** — the SET API
- **web** — nginx serving the UI, proxying \`/api\` and \`/ws\`
- **ollama** (optional profile) — local models

### Environment
\`JWT_SECRET\` (change in production!), \`SEED_DEMO\`, \`LLM_*\` bootstrap, \`RAGFLOW_URL\`/\`RAGFLOW_API_KEY\` (route retrieval through RAGFlow), \`HF_TOKEN\` (Library rate limits).

### Your data
Everything lives in **your Postgres** and the server \`data/\` directory (uploads, 3D models, source files). Export all pages as Markdown anytime from Settings → Workspace. Back up the database volume and \`data/\` — that's the whole product.

### Optional RAGFlow
Set the env vars and bind a notebook to a RAGFlow dataset (\`PATCH /api/notebooks/:id/ragflow\`) — retrieval then uses RAGFlow's deep document chunks, with automatic fallback to the built-in engine.
`,
  },
  {
    id: 'mobile',
    title: 'Mobile & the PWA',
    md: `
- **Install** — Add to Home Screen gives a full-screen app (iOS needs https; the dev server supports \`HTTPS_DEV=1\`).
- **Navigation** — the hamburger opens the sidebar as a drawer; it closes on navigation.
- **Copilot** — hidden by default on phones for space; open it from the top bar and close with the in-panel X.
- **Layout** — notch/home-indicator safe areas are respected; every view is overflow-audited at 390px.
- **3D** — orbit with one finger, pinch to zoom (Three.js touch controls).
- The mascot and your settings follow your account across devices.
`,
  },
  {
    id: 'security',
    title: 'Security & permissions',
    md: `
- JWT auth; passwords hashed (bcrypt).
- Space roles: **owner** (manage members, settings), **editor** (write content), **viewer** (read-only — enforced server-side, including notebooks, databases, files, and write-tool gates).
- The coding sandbox has no filesystem or network access and a hard timeout.
- Agent write tools can be gated behind per-run human approval.
- Self-hosted means your data never leaves your machines.
`,
  },
  {
    id: 'roadmap',
    title: 'Planned features',
    md: `
- **Mentions** — \`@teammate\` in comments and pages with instant notifications
- **Template kits** — cloneable per-organization onboarding packs
- **CRDT co-editing** — character-level real-time collaboration in the editor
- **Blender integration** — .blend metadata previews, render galleries, agent bridge
- **Docs viewer** for more file types (slides, sheets)
- **Hosted cloud** offering + LLM API proxy billing
- **Native clients** — PocketJS-style ultra-light runtime exploration
- **Deeper RAGFlow** — layout-aware OCR and table extraction pipelines
- **A2UI expansion** — more agent-generated components
`,
  },
  {
    id: 'mcp',
    title: 'MCP & Agents',
    md: `
## Connect AI clients over MCP

SET speaks the **Model Context Protocol** (Streamable HTTP, OAuth 2.1 + PKCE). Point any MCP client — Claude Desktop, Claude.ai connectors, Cursor, Claude Code, custom agents — at your server URL and complete a one-time consent.

**Endpoint:** \`http://localhost:8080/api/mcp\` in the default compose stack (\`http://localhost:4000\` in dev) · Quickstart guides: the **/agents** page on any deployment.

**Auth flow:** the client discovers our authorization server via RFC 9728 metadata, registers itself (RFC 7591), and opens the consent page where you pick the workspace and **Read-only** or **Read & write** scope. Tokens are revocable from Settings → MCP, where owners also see per-tool analytics and full call logs.

### Tools (26)

#### Read tools — scope \`mcp:read\`
- **search_workspace** *(query: string, limit?: number)* — full-text search across pages, databases, notebooks. Always the first tool to call when looking for content. Returns \`{pages[], notebooks[], databases[]}\`.
- **list_pages** *()* — every page with id, title, hierarchy and daily-note flag.
- **read_page** *(ref: string)* — a page as Markdown by id or exact title. Wiki links preserved.
- **read_page_backlinks** *(ref: string)* — pages linking in, pages linked out.
- **list_databases** *()* — databases with row counts.
- **query_database** *(databaseId: string, filter?: string)* — schema (columns + types) and rows; optional substring filter over row values.
- **list_notebooks** *()* — research notebooks with source/chunk counts.
- **list_sources** *(notebookId: string)* — indexed sources with ingestion status.
- **search_knowledge** *(query: string, notebookId?: string, limit?: number)* — hybrid semantic+keyword retrieval over a notebook's sources; returns cited excerpts with source name, page label and scores. Use before answering questions about your documents.
- **list_study_decks** *()* / **get_deck** *(deckId: string)* — generated flashcards, quizzes, guides, audio scripts.
- **list_my_tasks** *()* — assigned paths (due dates, progress) + open checkbox tasks across pages.
- **list_activity** *(limit?: number)* — the workspace activity feed.
- **list_notifications** *()* — the user's assignments, due-soon, @mentions, comments.
- **list_models_3d** *()* — 3D/CAD models (requires the 3D & CAD surface).

#### Write tools — scope \`mcp:write\`
- **create_page** *(title: string, markdown?: string, parentRef?: string)* — creates a page; \`[[wiki links]]\` resolve automatically.
- **append_to_page** *(ref: string, markdown: string)* — appends Markdown to an existing page.
- **update_page_properties** *(ref: string, title?: string, icon?: string)* — rename/re-icon.
- **create_comment** *(ref: string, body: string)* — comments; @Name mentions notify members.
- **create_database_row** *(databaseId: string, title?: string, cells?: object)* — adds a row (linked page created); cells keyed by column name.
- **update_database_row** *(rowId: string, cells: object)* — updates cells by column name. Idempotent.
- **create_notebook** *(title: string, description?: string)* — new research notebook.
- **add_notebook_source** *(notebookId: string, name: string, text: string)* — text source, auto-indexed for grounded search.
- **generate_study_material** *(notebookId: string, kind: 'flashcards'|'quiz'|'studyguide'|'audio', topic?: string, count?: number)* — LLM-generated study material from sources.
- **import_from_dataset** *(datasetId: string, path: string, notebookId?: string)* — imports from public HuggingFace datasets (Library surface required).
- **create_page_template** *(title: string, markdown?: string)* — reusable page template.

All writes respect the user's role (viewers get an error result) and disabled work surfaces. Errors return as \`isError\` results with a message, never crash the session.

### Resources & Prompts
Resources: \`set://pages\`, \`set://pages/{id}\`, \`set://mytasks\`. Prompts: \`set/daily-brief\`, \`set/research-brief\`, \`set/page-outline\`.

### Errors
\`-32601\` unknown method · \`-32000\` auth failures (with \`WWW-Authenticate\` RFC 9728 challenge when unauthenticated) · \`-32002\` unknown resource/prompt · tool errors as \`isError: true\` results.

### Machine-readable manifest
\`GET /api/mcp/docs.json\` returns the full tool catalog for client integrations and store review materials.
`,
  },
  {
    id: 'faq',
    title: 'FAQ',
    md: `
**Do I need an LLM?** No — search, indexing, databases, pages and teams all work without one. Chat/generation needs a provider; add one in Settings.

**Can I use it alone?** Yes — the personal vault is a first-class personal knowledge home.

**Where do files go?** Your Postgres + the server's \`data/\` directory. Export to Markdown anytime.

**Is it really open source?** AGPL-3.0 — free to self-host forever; dual-licensing available for hosted/enterprise.

**Why is a feature missing from my sidebar?** It's a work surface — enable it in Settings → Work surfaces.

**How do I cite sources in chat answers?** You don't — the copilot cites automatically; click any \`[n]\` chip to verify against the original chunk.
`,
  },
];

export default function DocsView({ standalone = false }: { standalone?: boolean }) {
  const [searchParams] = useSearchParams();
  const initial = searchParams.get('section');
  const [active, setActive] = useState(
    initial && SECTIONS.some((s) => s.id === initial) ? initial : SECTIONS[0].id
  );
  const [navOpen, setNavOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const section = useMemo(() => SECTIONS.find((s) => s.id === active) ?? SECTIONS[0], [active]);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [active]);

  const nav = (
    <div className="w-56 shrink-0 border-r border-set-border bg-set-panel overflow-y-auto p-3 space-y-0.5 pt-[max(0.75rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))] max-md:h-full">
      {standalone && (
        <Link to="/login" className="set-btn-ghost text-xs mb-3 flex items-center gap-1.5">
          <BookOpen size={13} /> Open SET
        </Link>
      )}
      {SECTIONS.map((s, i) => (
        <button
          key={s.id}
          className={`w-full text-left px-2.5 py-1.5 rounded-md text-sm ${active === s.id ? 'bg-set-accent/20 text-blue-200' : 'text-set-text/80 hover:bg-set-panel2'}`}
          onClick={() => {
            setActive(s.id);
            setNavOpen(false);
          }}
        >
          <span className="text-set-dim mr-1.5 text-xs">{String(i + 1).padStart(2, '0')}</span>
          {s.title}
        </button>
      ))}
    </div>
  );

  return (
    <div className="h-full flex">
      {standalone && (
        <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-12 bg-set-panel border-b border-set-border flex items-center px-3 gap-2 pt-[env(safe-area-inset-top)]">
          <button className="set-btn-ghost p-1.5" onClick={() => setNavOpen(true)} aria-label="Open docs menu">
            <Menu size={18} />
          </button>
          <span className="font-semibold">SET Docs</span>
        </div>
      )}
      <div className="max-md:hidden">{nav}</div>
      {navOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setNavOpen(false)} />
          <div className="relative h-full">{nav}</div>
        </div>
      )}
      <div ref={contentRef} className={`flex-1 overflow-y-auto pr-[env(safe-area-inset-right)] ${standalone ? 'max-md:pt-14 pb-[env(safe-area-inset-bottom)]' : ''}`}>
        <div className="max-w-3xl mx-auto px-5 sm:px-10 py-8 pb-24">
          {standalone && (
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-white">SET Documentation</h1>
              <p className="text-set-dim mt-2">
                The open-source, self-hostable Knowledge + Learning OS — structured workspaces, a connected
                knowledge graph, grounded AI research, an agent copilot, and optional work surfaces.
              </p>
            </div>
          )}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] uppercase tracking-widest text-set-dim">
              {SECTIONS.findIndex((s) => s.id === active) + 1} / {SECTIONS.length}
            </span>
          </div>
          <h2 className="text-2xl font-bold text-white mb-4">{section.title}</h2>
          <div className="prose-set max-w-none" dangerouslySetInnerHTML={md(section.md)} />
          <div className="flex justify-between mt-10 pt-4 border-t border-set-border">
            {(() => {
              const idx = SECTIONS.findIndex((s) => s.id === active);
              const prev = SECTIONS[idx - 1];
              const next = SECTIONS[idx + 1];
              return (
                <>
                  <button
                    className="text-sm text-set-dim hover:text-set-text disabled:opacity-30"
                    disabled={!prev}
                    onClick={() => prev && setActive(prev.id)}
                  >
                    &larr; {prev?.title ?? 'Start'}
                  </button>
                  <button
                    className="text-sm text-blue-300 hover:text-blue-200 disabled:opacity-30"
                    disabled={!next}
                    onClick={() => next && setActive(next.id)}
                  >
                    {next?.title ?? 'Done!'} &rarr;
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      </div>
      {standalone && (
        <button
          className="md:hidden fixed bottom-4 right-4 z-40 set-card px-3 py-2 bg-set-panel/95 text-xs flex items-center gap-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
          onClick={() => setNavOpen((o) => !o)}
        >
          <BookOpen size={13} /> Sections
        </button>
      )}
    </div>
  );
}
