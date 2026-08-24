-- MCP (Model Context Protocol) support: OAuth clients, tokens, call analytics
CREATE TABLE IF NOT EXISTS mcp_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text UNIQUE NOT NULL,
  client_name text NOT NULL DEFAULT 'MCP client',
  redirect_uris jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  scope text NOT NULL DEFAULT 'mcp:read',
  token_hash text UNIQUE NOT NULL,
  refresh_hash text UNIQUE,
  status text NOT NULL DEFAULT 'active', -- active | revoked
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE TABLE IF NOT EXISTS mcp_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  tool text NOT NULL,
  ok boolean NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_calls_space_idx ON mcp_calls(space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_calls_tool_idx ON mcp_calls(tool);
