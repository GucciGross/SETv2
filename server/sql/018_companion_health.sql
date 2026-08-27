-- Companion health: the local companion heartbeats a diagnostics snapshot
-- (cua-driver daemon, AT-SPI, input permission) every ~45s; Settings →
-- Companion shows it live. Stored on the token row so it survives server
-- restarts and revoking a token removes its health too.
ALTER TABLE companion_tokens ADD COLUMN IF NOT EXISTS health jsonb;
ALTER TABLE companion_tokens ADD COLUMN IF NOT EXISTS health_at timestamptz;
