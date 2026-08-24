# SET QA

## When to use
Before committing or pushing changes.

## Pre-push checklist
1. `cd server && npm run typecheck && npm test`
2. `cd web && npm run build`
3. If you changed API routes: restart the stack, run `node smoke.mjs` — all checks must pass
4. If you changed MCP: restart, run `node mcp-smoke.mjs`
5. If you changed UI: open the app in a browser and visually verify the affected view at 1440px and 390px (phone)
6. Check for horizontal overflow: `document.documentElement.scrollWidth <= window.innerWidth`
7. Verify no emojis appear in any rendered view
8. No competitor product names in any rendered text
