# Security policy

## Reporting a vulnerability

Email the maintainers privately (see the SECURITY_CONTACT field in the repository settings).
Please do not open public issues for vulnerabilities. We aim to respond within 72 hours.

## Hardening notes for self-hosters

- Set a strong `JWT_SECRET` (required in production).
- Put SET behind TLS (a reverse proxy or the `HTTPS_DEV` dev server is not a production certificate).
- Configure `SMTP_*` so password-reset emails work.
- The coding sandbox runs with no filesystem/network access and a hard timeout; agent write
  actions can be gated behind human approval in workspace settings.
- Keep Postgres and the `data/` volume private; they contain all workspace content.

## Supported versions

Only the latest main branch receives security fixes.
