-- Additive: existing active copilot skills and notebook/source ownership are unchanged.
CREATE TABLE IF NOT EXISTS skill_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  parent_id uuid REFERENCES skill_drafts(id) ON DELETE SET NULL,
  input jsonb NOT NULL,
  plan jsonb NOT NULL,
  evidence jsonb NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'revoked')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skill_drafts_space_created_idx ON skill_drafts(space_id, created_at DESC);
