-- Native H5P activities are additive: existing decks, assessments and page JSON stay intact.
CREATE TABLE h5p_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 255),
  draft_revision integer NOT NULL DEFAULT 0 CHECK (draft_revision >= 0),
  published_revision integer,
  access_epoch integer NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false,
  source_deck_id uuid REFERENCES decks(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, space_id)
);
CREATE INDEX h5p_activities_space ON h5p_activities(space_id, archived, updated_at DESC);

-- Each save gets new, immutable content files. Publishing only changes the pointer.
CREATE TABLE h5p_revisions (
  activity_id uuid NOT NULL REFERENCES h5p_activities(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  content_id text NOT NULL CHECK (content_id ~ '^[0-9]{1,16}$'),
  title text NOT NULL,
  library text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  PRIMARY KEY (activity_id, revision),
  UNIQUE (content_id)
);
ALTER TABLE h5p_activities ADD CONSTRAINT h5p_published_revision_fk
  FOREIGN KEY (id, published_revision) REFERENCES h5p_revisions(activity_id, revision)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE h5p_placements (
  activity_id uuid NOT NULL,
  space_id uuid NOT NULL,
  page_id uuid REFERENCES pages(id) ON DELETE CASCADE,
  notebook_id uuid REFERENCES notebooks(id) ON DELETE CASCADE,
  path_id uuid REFERENCES learning_paths(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (activity_id, space_id) REFERENCES h5p_activities(id, space_id) ON DELETE CASCADE,
  CHECK (num_nonnulls(page_id, notebook_id, path_id) = 1)
);
CREATE UNIQUE INDEX h5p_placement_page ON h5p_placements(activity_id, page_id) WHERE page_id IS NOT NULL;
CREATE UNIQUE INDEX h5p_placement_notebook ON h5p_placements(activity_id, notebook_id) WHERE notebook_id IS NOT NULL;
CREATE UNIQUE INDEX h5p_placement_path ON h5p_placements(activity_id, path_id) WHERE path_id IS NOT NULL;

-- Native H5P resume state is private to its learner and immutable content revision.
CREATE TABLE h5p_user_state (
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  content_id text NOT NULL REFERENCES h5p_revisions(content_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data_type text NOT NULL,
  sub_content_id text NOT NULL,
  context_id text NOT NULL DEFAULT '',
  user_state text NOT NULL CHECK (octet_length(user_state) <= 1048576),
  preload boolean NOT NULL,
  invalidate boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, content_id, user_id, data_type, sub_content_id, context_id)
);
CREATE TABLE h5p_finished (
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  content_id text NOT NULL REFERENCES h5p_revisions(content_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score double precision NOT NULL CHECK (score >= 0 AND score <= max_score),
  max_score double precision NOT NULL CHECK (max_score >= 0 AND max_score <= 1000000),
  opened_timestamp bigint NOT NULL,
  finished_timestamp bigint NOT NULL,
  completion_time bigint NOT NULL CHECK (completion_time >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, content_id, user_id)
);
COMMENT ON TABLE h5p_finished IS 'Client-reported practice data only. Never authoritative assessment grades or automatic certification.';
