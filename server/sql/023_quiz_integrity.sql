-- Quiz integrity + assessment: decks carry per-deck settings (shuffle, time
-- limit, attempt cap, bank draw size); attempts snapshot the exact question
-- set served to that student, keep answers server-side, and support manual
-- grading of open-answer questions.
ALTER TABLE decks ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id uuid NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'in_progress',   -- in_progress | submitted | graded
  items_snapshot jsonb NOT NULL DEFAULT '[]',   -- full items incl. answers (never sent raw to clients)
  answers jsonb NOT NULL DEFAULT '{}',          -- {itemIndex: answerIndex | "text"}
  total_points numeric NOT NULL DEFAULT 0,
  auto_score numeric,
  manual jsonb NOT NULL DEFAULT '[]',           -- [{index, score, feedback}] open-answer grades
  final_score numeric,
  late boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  deadline timestamptz,
  submitted_at timestamptz,
  graded_at timestamptz,
  graded_by uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_deck_user ON quiz_attempts (deck_id, user_id, started_at DESC);
