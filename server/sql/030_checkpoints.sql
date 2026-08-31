-- Project checkpoints: runnable, auto-graded milestones embedded in pages
-- (```js code blocks whose first line is a "// checkpoint:" marker). One row
-- per (page, user, checkpoint) holding the latest attempt; passed_at keeps
-- the first-pass time. Feeds the mastery map and auto-ticks path items.
CREATE TABLE IF NOT EXISTS checkpoint_results (
  page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checkpoint_index integer NOT NULL,
  passed boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  actual text,
  passed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, user_id, checkpoint_index)
);
CREATE INDEX IF NOT EXISTS idx_checkpoint_results_page ON checkpoint_results (page_id, user_id);
