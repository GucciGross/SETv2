-- Web clipper: long-lived personal tokens so a bookmarklet on another origin
-- can POST pages straight into a SET notebook. Only the sha256 hash is
-- stored; the plaintext is shown once at creation and revocable anytime.
CREATE TABLE IF NOT EXISTS clip_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'bookmarklet',
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_clip_tokens_user ON clip_tokens (user_id);
