-- SET — Strategic Enablement Toolkit v2 · initial schema
-- Extensions are optional: the app stores embeddings as jsonb (pgvector-ready layout)
-- and falls back to ILIKE search when pg_trgm is unavailable.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector not available — embeddings stay in jsonb';
END $$;
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm not available — falling back to ILIKE search';
END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'team', -- 'personal' | 'team'
  icon text DEFAULT '🚀',
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'editor', -- 'owner' | 'editor' | 'viewer'
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, space_id)
);

CREATE TABLE IF NOT EXISTS pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES pages(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled',
  icon text,
  content jsonb NOT NULL DEFAULT 'null'::jsonb, -- TipTap doc JSON
  markdown text NOT NULL DEFAULT '',
  is_daily boolean NOT NULL DEFAULT false,
  daily_date date,
  is_template boolean NOT NULL DEFAULT false,
  template_of uuid REFERENCES pages(id) ON DELETE SET NULL,
  sort_order double precision NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS pages_space_idx ON pages(space_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pages_parent_idx ON pages(parent_id);
CREATE INDEX IF NOT EXISTS pages_daily_idx ON pages(space_id, daily_date) WHERE is_daily;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS pages_md_trgm ON pages USING gin (markdown gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'trgm index skipped (pg_trgm missing)';
END $$;

-- Resolved wiki links between pages ([[Title]] → page)
CREATE TABLE IF NOT EXISTS links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, target_id, text)
);
CREATE INDEX IF NOT EXISTS links_target_idx ON links(target_id);

CREATE TABLE IF NOT EXISTS databases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  parent_page_id uuid REFERENCES pages(id) ON DELETE SET NULL,
  name text NOT NULL,
  icon text,
  schema jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{id,name,type,config}] type: text|number|select|multiSelect|date|checkbox|person|url
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS db_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  database_id uuid NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  page_id uuid REFERENCES pages(id) ON DELETE SET NULL,
  cells jsonb NOT NULL DEFAULT '{}'::jsonb, -- {colId: value}
  sort_order double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS db_rows_db_idx ON db_rows(database_id);

CREATE TABLE IF NOT EXISTS db_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  database_id uuid NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'table', -- table|kanban|calendar|gallery
  config jsonb NOT NULL DEFAULT '{}'::jsonb, -- {groupBy, dateColumn, galleryColumn, filters}
  sort_order double precision NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS learning_paths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text DEFAULT '',
  items jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{pageId, note}]
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS path_progress (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  path_id uuid NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
  item_index integer NOT NULL,
  done boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, path_id, item_index)
);

CREATE TABLE IF NOT EXISTS notebooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text DEFAULT '',
  embedding_dim integer NOT NULL DEFAULT 384,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id uuid NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  kind text NOT NULL, -- pdf|md|txt|web|transcript|image
  name text NOT NULL,
  uri text,
  mime text,
  size_bytes integer DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  text_content text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending', -- pending|chunking|embedding|ready|error
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sources_nb_idx ON sources(notebook_id);

CREATE TABLE IF NOT EXISTS chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  notebook_id uuid NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  heading text DEFAULT '',
  content text NOT NULL,
  page_label text, -- e.g. PDF page number
  embedding jsonb, -- number[] (dim per notebook; pgvector-ready layout)
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  tsv tsvector,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, idx)
);
CREATE INDEX IF NOT EXISTS chunks_nb_idx ON chunks(notebook_id);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin (tsv);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  notebook_id uuid REFERENCES notebooks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New chat',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role text NOT NULL, -- user|assistant
  content text NOT NULL DEFAULT '',
  citations jsonb, -- [{chunkId,sourceId,sourceName,pageLabel,span:[start,end],quote}]
  components jsonb, -- A2UI components rendered alongside the message
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_session_idx ON messages(session_id);

CREATE TABLE IF NOT EXISTS providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  base_url text NOT NULL,
  api_key text,
  chat_model text,
  embed_model text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  space_id uuid PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb -- {agentApprovals:boolean, defaultProviderId, ...}
);

CREATE TABLE IF NOT EXISTS models3d (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'gltf', -- gltf | urdf
  file_path text NOT NULL,
  file_size integer NOT NULL DEFAULT 0,
  parts jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{node,name,linkedPageId}]
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  notebook_id uuid REFERENCES notebooks(id) ON DELETE CASCADE,
  kind text NOT NULL, -- flashcards | quiz | studyguide | audio
  title text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
  deck_id uuid NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_index integer NOT NULL,
  ease real NOT NULL DEFAULT 2.5,
  interval_days real NOT NULL DEFAULT 0,
  reps integer NOT NULL DEFAULT 0,
  due_at timestamptz NOT NULL DEFAULT now(),
  last_grade integer,
  PRIMARY KEY (deck_id, user_id, item_index)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{role,content}]
  status text NOT NULL DEFAULT 'running', -- running|awaiting_approval|finished|error|rejected
  tool_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  mime text,
  size_bytes integer NOT NULL DEFAULT 0,
  path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- keep chunks' full-text index fresh
CREATE OR REPLACE FUNCTION chunks_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.tsv := to_tsvector('english', coalesce(NEW.heading,'') || ' ' || NEW.content);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER chunks_tsv_trg
  BEFORE INSERT OR UPDATE OF content, heading ON chunks
  FOR EACH ROW WHEN (NEW.tsv IS NULL)
  EXECUTE FUNCTION chunks_tsv_update();
