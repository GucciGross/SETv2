-- Additive, reversible application rollout: do not remove user content or BYOK keys.
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS operator_managed boolean NOT NULL DEFAULT false;
-- These rows were explicitly created from the operator's environment by the old router.
UPDATE providers SET operator_managed = true WHERE name = 'Default (env)';
CREATE TABLE IF NOT EXISTS revoked_sessions (
  session_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS revoked_sessions_expiry ON revoked_sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key text PRIMARY KEY,
  hits integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_rate_limits_expiry ON auth_rate_limits(expires_at);
-- Password changes outside the reset API must invalidate sessions as well.
CREATE OR REPLACE FUNCTION set_bump_session_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    NEW.session_version := OLD.session_version + 1;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS users_password_session_version ON users;
CREATE TRIGGER users_password_session_version BEFORE UPDATE OF password_hash ON users
FOR EACH ROW EXECUTE FUNCTION set_bump_session_version();
