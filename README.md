#  SET — Strategic Enablement Toolkit v2

**An open-source, self-hostable Knowledge + Learning Operating System.**

> **The self-hostable Knowledge + Learning Operating System** — structured documents and databases, a connected knowledge graph, grounded AI research with citations, and an agent copilot. Docker-first, bring your own LLM, local-first data ownership, optional hosted cloud.

**Core (always on):**

| Layer | What you get |
|---|---|
| **Structured Workspace** | Hierarchical pages, rich block editor (TipTap) with tables, images, highlights, slash menu & `[[` autocomplete, relational databases with table/kanban/calendar/gallery views, spaces & permissions |
| **Connected Knowledge Graph** | `[[wiki links]]` with bidirectional backlinks, unlinked mentions, block-level references with permanent IDs, interactive force-directed graph, full Markdown import/export, daily notes |
| **Grounded Research** | Multi-source notebooks (PDF / Markdown / web / transcripts / pasted text), structure-aware chunking with human-in-the-loop correction, grounded chat with inline citations, knowledge views (mind map / tree / timeline / page index), generated flashcards, quizzes, study guides & audio overviews with spaced repetition |
| **AI Copilot** | AG-UI-style streaming agent with workspace tools, human-in-the-loop approvals, A2UI generative UI (cards, tables, forms, quizzes, flashcards, 3D viewers) |

**Optional work surfaces (toggle per space in Settings):**

| Surface | What you get |
|---|---|
| **Coding** (on by default) | Code files with a CodeMirror editor and a sandboxed JavaScript runner (no fs/network, timeout-capped) |
| **Terminal** (on by default) | Workspace console: `pages`, `open`, `find` (grounded search), `new`, `runjs`, `surfaces`, `stat` |
| **3D & CAD** | Interactive 3D learning: GLB/GLTF with explode view, STL/OBJ meshes, URDF robotics with animated joints, STEP import via OpenCascade WASM, clickable parts linked to notes |
| **Library** | Leverage what's already out there: curated HuggingFace datasets (markov-ai/cad-1000-hours expert CAD workflows, Objaverse 3D, textbooks, Wikipedia, GSM8K...) browsable and importable into notebooks / 3D viewer / files — parquet included |
| **Learning Paths** | Ordered curricula with per-member readiness tracking |
| **Canvas** | Experimental infinite-canvas spatial view over your pages |

---|---|
| **Structured Workspace** | Hierarchical pages, rich block editor (TipTap) with tables, images, highlights, slash menu & `[[` autocomplete, relational databases with table/kanban/calendar/gallery views, learning paths, templates, spaces & permissions |
| **Connected Knowledge Graph** | `[[wiki links]]` with bidirectional backlinks, unlinked mentions, block-level references with permanent IDs (`((id))` embeds + copy-block-id), interactive force-directed graph, Markdown import/export (full rich round-trip), daily notes |
| **Grounded Research** | Multi-source notebooks (PDF / Markdown / web / transcripts / pasted text), structure-aware chunking with human-in-the-loop correction, grounded chat with inline citations, knowledge views (mind map / tree / timeline / page index), generated flashcards, quizzes, study guides & two-host audio overviews with spaced repetition |
| **AI Agents** | AG-UI-style streaming agent runtime, 8 workspace tools (read/write pages, hybrid knowledge search, study generation, 3D, generative UI), human-in-the-loop approvals, A2UI declarative generative UI (cards, tables, forms, quizzes, flashcards, 3D viewers) |
| **3D Learning (Three.js)** | GLB/GLTF viewer with explode view & clickable parts linked to notes, URDF robotics support with animated joints, "Explain this actuator" AI flow, auto-linking parts  pages |
| **Infra** | Single `docker compose up`, Postgres + pgvector (optional) + Redis pub/sub, WebSocket presence & live sync, BYOK LLM router (Ollama / LM Studio / vLLM / OpenAI / OpenRouter / Groq), optional RAGFlow retrieval provider |

---

## Quick start (Docker)

```bash
cp .env.example .env        # set JWT_SECRET for production
docker compose up -d        # builds server + web + Postgres(pgvector) + Redis
open http://localhost:8080
```

Register an account (first user) or seed the demo workspace:

```bash
SEED_DEMO=1 docker compose up -d   # login: demo@set.local / demo-demo
```

The demo includes linked pages, an experiments database with all four views, an
indexed research notebook (chat-ready without any LLM), a learning path, and an
animated URDF robot arm in the 3D viewer.

### Connect an LLM (BYOK)

Everything works without an LLM except chat/generation (search & embeddings fall
back to a built-in hashed index). To enable the full experience add a provider in
**Settings  AI Providers**:

| Provider | Base URL | Notes |
|---|---|---|
| Ollama (local) | `http://host.docker.internal:11434/v1` | `ollama pull llama3.1` + `ollama pull nomic-embed-text` |
| LM Studio | `http://host.docker.internal:1234/v1` | start the local server |
| vLLM | `http://your-host:8000/v1` | any hosted model |
| OpenAI / OpenRouter / Groq | official URLs | API key |

Or run Ollama inside compose: `docker compose --profile ollama up -d`.

### Local development

```bash
# Postgres + Redis via docker (or your own)
docker compose up -d db redis

# backend (http://localhost:4000)
cd server && npm install && npm run dev

# frontend (http://localhost:5173, proxies /api)
cd web && npm install && npm run dev
```

Handy scripts: `npm run migrate` (server), `SEED_DEMO=1 npm run seed` (server),
`npm test` (server, 10 unit tests), `node smoke.mjs` (server, 54-check API smoke
suite against a running instance — run once per fresh database).

---

## Architecture

```

  Web (React + Vite + Tailwind)                             
  TipTap block editor · Graph view · DB views · Notebooks   
  Copilot panel (AG-UI client + A2UI renderer) · Three.js  

                /api (REST + SSE)  ·  /ws (WebSocket)

  SET Server (Node.js + TypeScript + Fastify)               
  Auth/JWT · Spaces & permissions · Pages & wiki-links      
  Databases & views · RAG engine (chunkembedhybrid search)
  Grounded chat (citations) · Agent runtime + HITL + A2UI   
  Study generator + SM-2 SRS · 3D model mgr + URDF parser   
  LLM router (OpenAI-compatible, BYOK, presets)             

                             
           
 Postgres             Object/file storage    LLM router  
 (+pgvector           (files, 3D models)     Ollama/vLLM 
  optional)              /OpenAI/etc 
                                  
        Redis (pub/sub collab, presence) — optional, in-memory fallback
```

### How grounding works

1. Sources are parsed (PDF text extraction, web fetch & boilerplate strip, or raw text).
2. A structure-aware chunker splits along headings/paragraphs with size budget + overlap.
3. Chunks are embedded via the configured embedding model (or the deterministic
   built-in hash embedding — so search works with zero LLM).
4. Retrieval fuses Postgres full-text ranking and vector cosine similarity via
   Reciprocal Rank Fusion.
5. Answers must cite sources inline `[1] [2]`; the UI shows the exact chunk on click.
6. Humans can inspect and correct any chunk, then re-embed it.

**RAGFlow integration (optional):** set `RAGFLOW_URL` and `RAGFLOW_API_KEY` and bind a
notebook to a RAGFlow dataset (`PATCH /api/notebooks/:id/ragflow {datasetId}`) —
retrieval then routes through RAGFlow's deep-document-understanding chunks, with
graceful fallback to the built-in engine when unavailable.

### The rich editor

- **Slash menu** — type `/` at a word start for headings, lists, tasks, tables,
  code, quotes, dividers, images, wiki links and block references.
- **`[[` autocomplete** — fuzzy page-title dropdown with create-on-the-fly.
- **Tables** — insert via `/table` or the toolbar; add/remove rows & columns,
  toggle header row; markdown pipe-table round-trip preserves column alignment.
- **Images** — paste or drop to upload (stored in your data dir, served by the
  API), or use the toolbar/`/image` picker.
- **Marks** — bold, italic, underline, ~~strike~~, ==highlight==, inline code, links.
- **Block references** — toolbar "Copy block id" stamps a permanent UUID on any
  paragraph/heading; embed it anywhere with `((id))` or `/block reference` —
  embeds render the live source text and link to the origin page.

### The agent layer

- Streams AG-UI-style lifecycle events (`RUN_STARTED`, `TEXT_MESSAGE_CONTENT`,
  `TOOL_CALL_START/END`, `CUSTOM`, `RUN_FINISHED`) over SSE.
- Tools: `search_workspace`, `read_page`, `create_page`, `append_to_page`,
  `search_knowledge`, `generate_study_material`, `open_3d_model`, `render_ui`.
- Write tools can require **human approval** (workspace setting) — the run pauses
  until you approve/reject in the copilot panel.
- Agents answer with **A2UI components** (cards, tables, forms, quizzes,
  flashcards, 3D viewers) that render natively in the chat.

### Repository layout

```
server/            Node.js + TypeScript backend (Fastify + Postgres)
  src/agents/      AG-UI runtime, tools, HITL approvals, A2UI emission
  src/rag/         chunker, hybrid search (RRF), grounded chat routes
  src/llm/         BYOK provider management + OpenAI-compatible router
  src/study/       flashcards/quiz/study-guide/audio generation + SM-2
  src/models3d/    GLB streaming + URDF kinematic parser + autolink
  sql/             migrations
  smoke.mjs        47-check end-to-end API suite
web/               React + Vite + Tailwind frontend
  src/components/  Editor, CopilotPanel, A2UI registry, Viewer3D …
  src/views/       Pages, Graph, Database, Notebooks, Study, Models, Paths, Canvas
docker-compose.yml Single-command self-host (db + redis + server + web [+ ollama])
```

---

## Monetization model (per product spec)

- **Self-host / open-source: free forever** (AGPL-3.0).
- Optional hosted cloud version.
- LLM API proxy / hosted models as primary revenue.

## Roadmap status

- **Phase 0 — Foundation:**  Docker Compose, block editor + Markdown import/export, databases, bidirectional links + graph, BYOK LLM + grounded RAG chat with citations, copilot runtime.
- **Phase 1 — Research strength:**  multi-source notebooks, visual chunk inspection + correction, high-precision citations, knowledge views (tree/mind map/timeline/index), study materials + learning paths.  deeper RAGFlow-style layout parsing (OCR, tables).
- **Phase 2 — Collaboration + agents:**  live sync + presence (WS/Redis), A2UI generative UI, HITL agents, permissions & team spaces.  CRDT character-level editing.
- **Phase 3 — Interactive learning:**  Three.js 3D environments, URDF robotics with joint animation, AI-controllable 3D scenes.  extensible tool surface.
- **Phase 4 — Polish & scale:**  canvas UI experiment.  hosted offering, LLM proxy billing, mobile, PocketJS exploration.

## License

Copyright (C) 2026 SET contributors.

SET is free software: you can redistribute it and/or modify it under the terms of
the **GNU Affero General Public License v3.0** (see [LICENSE](./LICENSE)) — the
license choice protects against closed commercial forks while keeping the project
fully open. Dual/commercial licensing available for hosted/enterprise use.
