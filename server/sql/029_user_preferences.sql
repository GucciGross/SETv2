-- Per-account preferences (Settings → Notifications and beyond). Generic
-- jsonb store; first user: daily-brief scheduling (briefEnabled, briefHour,
-- briefTz; briefLastDate is scheduler bookkeeping, never client-settable).
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
