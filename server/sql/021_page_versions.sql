-- Page version history: every content save snapshots the *previous* state,
-- so any edit (human or agent) is recoverable. Current content still lives
-- on the page row; this table is the undo timeline.
CREATE TABLE IF NOT EXISTS page_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  markdown text NOT NULL DEFAULT '',
  edited_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_page_versions_page ON page_versions (page_id, created_at DESC);
