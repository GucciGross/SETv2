# SET edition is not hosting location

A self-hosted installation may run on a laptop, a private server, or a public VPS.
A public domain does **not** convert it into the managed multi-tenant SET Cloud edition.
Use one codebase with explicit server-owned edition and exposure choices:

| Installation | Compose files | Edition | Exposure | Personal Codex |
|---|---|---|---|---|
| Trusted local/private | base | self-hosted | private | preserved |
| Public self-hosted, including the operator-reported trainwithset.com installation | base + hosted | self-hosted | public | preserved |
| Managed service | base + cloud, profile cloud | cloud | public | denied server-side |

## Existing public self-hosted installation

Do not add the cloud overlay just because the machine is in a datacenter. Do not
change project names or remove volumes: those contain the existing accounts and data.
Set `APP_URL=https://trainwithset.com`, `WEB_ORIGIN=https://trainwithset.com`, a unique
random `JWT_SECRET` (32+ characters), and the **existing** database password (16+
characters). If the existing database password is weak, rotate it in Postgres and
then update the configuration; changing the Compose variable alone does not rotate
an initialized database. Rotating JWT_SECRET signs out existing sessions.

`REGISTRATION_OPEN=0` closes public registration. Set it to `1` only when ready to
accept users. ForwardEmail or SMTP must be configured for delivery; validate real
reset and invitation emails before launch. SSO remains optional.

Set `SET_TRUST_PROXY` to the actual trusted reverse-proxy addresses/CIDRs only.
Do not use `true` or a catch-all range. Configure the outer proxy to sanitize
forwarded headers and keep the API port off the public interface. The default
(empty) trusts no proxy; configure it before evaluating per-client login limits.

Build and deploy from the intended checkout using the existing Compose project:

```sh
export SET_BUILD_REVISION="$(git rev-parse HEAD)"
docker compose -f docker-compose.yml -f docker-compose.hosted.yml up -d --build
node scripts/ops/check-deployment.mjs https://trainwithset.com
```

The output must identify `edition: self-hosted`, `exposure: public`, and the expected
server revision. It is a server check, not proof that the frontend or all user flows
work. The official self-hosted Codex sign-in, BYOK, companion, voice configuration,
and existing data are retained. This PR does not change the live host or TLS setup.

## Managed cloud

Use `docker compose -f docker-compose.yml -f docker-compose.cloud.yml --profile cloud up -d --build`.
The cloud overlay builds the normal runtime (not the Codex CLI image), disables
personal subscription sign-in, and removes server bootstrap LLM credentials.
Configure the upstream using `GATEWAY_UPSTREAM_URL/KEY`; tenant providers must not
receive the platform upstream credential. This is not a migration command for the
currently self-hosted site. Before a future conversion, inspect and remove legacy
shared-key provider rows and rotate the upstream key; configuration changes alone
do not erase keys already copied into the database.

Public startup fails closed for missing/weak secrets, wildcard/mismatched origins,
non-HTTPS canonical URLs and demo seeding. `NODE_ENV=production` alone does not
change the edition or prevent the trusted local Docker quick start.

## Scope

This establishes explicit deployment identity and production configuration. It
is not a claim that all findings in the September audit are closed. Run the full
security, billing, browser, restore and ingress acceptance suite before launch.
