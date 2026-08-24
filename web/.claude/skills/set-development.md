# SET Development

## When to use
Any change to this repository.

## Design vocabulary
Use these exact terms (from *A Philosophy of Software Design*):

- **Module** — a self-contained unit with an interface (a route file, a component, a table)
- **Interface** — what callers see: function signatures, REST endpoints, React props
- **Depth** — a module is deep when its interface is simple but its implementation is powerful. Strive for deep modules.
- **Shallow** — a module that merely passes through. Delete or merge shallow modules.
- **Seam** — a boundary where you could swap implementations (the LLM router, the RAG provider). Two call sites make a seam real; one is hypothetical.

## Rules
1. The **deletion test**: if deleting a module and inlining it would simplify the codebase, it should not exist.
2. One adapter per external dependency (e.g., one `llm/router.ts`, not scattered fetch calls).
3. Routes are thin: validate, delegate to a lib function, return. No business logic in route handlers.
4. Frontend components are deep: complex internals, simple props.
5. All user-facing text in SET's own voice (no competitor product names).
6. No emojis in product UI or docs.
7. New endpoints need smoke test coverage in `server/smoke.mjs`.
8. Schema changes go in `server/sql/NNN_description.sql` migrations.

## Testing
- `cd server && npm test` (unit)
- `cd server && node smoke.mjs` (API, needs running stack)
- `cd server && node mcp-smoke.mjs` (MCP, needs running stack)
- `cd web && npm run build` (typecheck + production bundle)

## Key paths
- `server/src/lib/` — shared helpers (markdown, auth, events)
- `server/src/agents/` — copilot runtime + tools
- `server/src/rag/` — chunking, retrieval, provider abstraction
- `server/src/mcp/` — MCP server + OAuth
- `web/src/views/` — page components (one file per route)
- `web/src/components/` — shared components (Editor, CopilotPanel, Mascot, etc.)
