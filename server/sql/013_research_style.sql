-- Report styles: ste (Simplified Technical English, default), professional,
-- executive, study. See PLAN.md Phase 1.
ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS style text NOT NULL DEFAULT 'ste';
