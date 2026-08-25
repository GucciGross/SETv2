-- Deep research runs: long-running CrewAI research jobs (see PLAN.md Phase 1).
-- The Python research worker writes progress/sources here; Node ingests + reports.
CREATE TABLE IF NOT EXISTS research_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  notebook_id uuid REFERENCES notebooks(id) ON DELETE SET NULL,
  question text NOT NULL,
  status text NOT NULL DEFAULT 'pending',   -- pending|planning|researching|synthesizing|synthesized|ingesting|finished|error|cancelled
  outline jsonb NOT NULL DEFAULT '[]',      -- [{id, question, status, note}]
  progress jsonb NOT NULL DEFAULT '{}',     -- {pages_visited, pages_budget, domains, rounds, current}
  log jsonb NOT NULL DEFAULT '[]',          -- [{t, type, message}]
  report_md text,
  report_page_id uuid REFERENCES pages(id) ON DELETE SET NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_research_runs_space ON research_runs (space_id, created_at DESC);
