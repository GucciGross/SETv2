# Changelog

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
