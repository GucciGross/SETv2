-- Capture history (Phase 4 follow-up): every screenshot the computer-use
-- tools persist to DATA_DIR/captures gets a row here, so the web app can
-- show a gallery/activity log of what the agent saw and did on the desktop
-- instead of captures vanishing when the chat scrolls.
CREATE TABLE IF NOT EXISTS captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  file text NOT NULL UNIQUE,          -- filename under DATA_DIR/captures
  action text NOT NULL DEFAULT 'capture',  -- capture | act:<action>
  window_title text,
  window_id text,
  width int,
  height int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_captures_space_time ON captures (space_id, created_at DESC);
