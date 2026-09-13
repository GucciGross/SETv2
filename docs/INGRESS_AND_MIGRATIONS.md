# Shared ingress and migration fixes

These changes apply to private self-hosted, public self-hosted and managed cloud
without changing the selected edition or personal Codex policy.

The collaboration route is registered at `/api/ws`. Both HTTP and HTTPS Nginx
configurations now upgrade that exact path; legacy `/ws` clients are forwarded
to the same server route. Existing bearer/query authentication and membership
checks still run. `/health` now proxies to the API rather than returning the SPA
HTML. It is **liveness**, not dependency-aware readiness: a separate readiness
check and graceful draining are still needed before rolling multi-instance
operation. SSE buffering settings and the existing upload limits are unchanged.

The migration runner obtains one PostgreSQL session advisory lock before reading
migration history and holds it across all per-file transactions. Simultaneous
API startups serialize instead of racing to apply the same migration. Both tsx
and compiled `node dist/migrate.js` entry points run the migrator and close the
pool afterwards. This assumes a session-capable database connection; do not use
a transaction-pooling endpoint for migrations. Use the direct database endpoint
for the migration job. This does not make destructive migrations reversible.

CI boots real built server/web images with disposable Postgres and checks HTTP,
HTTPS, WS and WSS. It verifies JSON liveness, both socket paths and anonymous
socket denial, without printing credentials. Existing browser regressions are
not bypassed. Migration tests cover lock/transaction/cleanup ordering; production
backup consistency and an actual restore drill remain separate release gates.
