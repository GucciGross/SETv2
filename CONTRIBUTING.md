# Contributing to SET

Thanks for helping build the open-source Knowledge + Learning OS.

## Setup

    docker compose up -d db redis
    cd server && npm install && npm run dev   # API on :4000
    cd web && npm install && npm run dev      # UI on :5173

## Before opening a PR

- `cd server && npm run typecheck && npm test`
- `cd web && npm run build`
- New endpoints need coverage in `server/smoke.mjs` (run once against a fresh database).
- No emojis in product UI or docs (we use Lucide icons).
- Describe features in SET's own words; avoid comparisons to other products.

## Finding issues

Look for the `good first issue` label. The docs (`web/src/views/DocsView.tsx`) and the
smoke suite are great places to learn the surface area fast.

## License

By contributing you agree your work is released under AGPL-3.0.
