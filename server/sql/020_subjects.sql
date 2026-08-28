-- Subjects: the top-level study container (a class, course or topic).
-- Notebooks — and through them sources, decks and auto-notes — group under a
-- subject; pages stay general-purpose. Deleting a subject leaves its
-- notebooks intact (subject_id clears via ON DELETE SET NULL).
CREATE TABLE IF NOT EXISTS subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  color text NOT NULL DEFAULT '#7aa2ff',
  position double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subjects_space_idx ON subjects(space_id);

ALTER TABLE notebooks ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL;
