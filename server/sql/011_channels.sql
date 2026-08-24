-- Channels (Slack via CopilotKit Intelligence): map external platforms to SET spaces.

-- CopilotKit clients use their own thread ids ("thread_…"); keep continuity for
-- agent_runs threads across runs keyed by the client thread id.
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS client_thread_id TEXT;
CREATE INDEX IF NOT EXISTS agent_runs_client_thread_idx ON agent_runs (client_thread_id) WHERE client_thread_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS channel_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,                    -- 'slack' | 'teams' | ...
  platform_id TEXT NOT NULL,                 -- Slack team_id (workspace) or channel id
  platform_name TEXT,                        -- display name from the platform
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  linked_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, platform_id)
);

-- Optional per-space attribution of platform users to SET users.
CREATE TABLE IF NOT EXISTS channel_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  platform_user_name TEXT,
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, platform_user_id, space_id)
);
