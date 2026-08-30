-- WandGx creation connector: SET delegates app generation to a WandGx
-- instance (prompt → GitHub repo, Docker setup, live URL). One row per build
-- kicked off from a space; webhook events on /api/wandgx/events keep status
-- and result URLs current, and append to the linked page's Build log.
CREATE TABLE IF NOT EXISTS wandgx_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id),
  page_id uuid REFERENCES pages(id) ON DELETE SET NULL,  -- page whose Build log tracks this build
  title text NOT NULL,
  prompt text NOT NULL,
  wandgx_project_id text,
  wandgx_build_id text,
  status text NOT NULL DEFAULT 'queued',   -- queued | building | deployed | error
  repo_url text,
  live_url text,
  error text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wandgx_builds_external
  ON wandgx_builds (space_id, wandgx_build_id) WHERE wandgx_build_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wandgx_builds_space ON wandgx_builds (space_id, created_at DESC);
