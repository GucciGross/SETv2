-- Phase 5 step 1: LLM gateway + usage metering (PLAN.md).
-- gateway_keys: per-space credentials for the OpenAI-compatible gateway
-- (issued by the main server, validated by the gateway against the shared
-- DB — same shape as companion_tokens). usage_events: one row per forwarded
-- model call, the basis for spend caps now and Stripe metered billing later.
CREATE TABLE IF NOT EXISTS gateway_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'default',
  key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_gateway_keys_space ON gateway_keys (space_id);

CREATE TABLE IF NOT EXISTS usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  kind text NOT NULL,                    -- chat | embeddings
  model text NOT NULL DEFAULT '',
  prompt_tokens int NOT NULL DEFAULT 0,
  completion_tokens int NOT NULL DEFAULT 0,
  total_tokens int NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  estimated boolean NOT NULL DEFAULT false,  -- tokens estimated, not reported by upstream
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_space_time ON usage_events (space_id, created_at DESC);
