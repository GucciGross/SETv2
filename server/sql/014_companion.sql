-- Phase 2: show-me teaching companion (PLAN.md). The companion runs ON THE
-- USER'S MACHINE, attaches to their real browser over CDP, and executes
-- visible teach tasks (navigate + highlight + narrate). It authenticates to
-- SET with a revocable pairing token.
CREATE TABLE IF NOT EXISTS companion_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'companion',
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS teach_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  url text,                 -- absolute or SET-relative path to open
  selector text,            -- CSS selector to highlight (optional)
  message text,             -- narration shown next to the highlight
  status text NOT NULL DEFAULT 'queued',  -- queued|running|done|error
  result text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_teach_tasks_queue ON teach_tasks (space_id, status, created_at);
