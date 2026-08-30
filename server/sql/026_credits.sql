-- Prepaid SET Cloud credits (Phase 5 money path v1): an append-only ledger
-- per space. Purchases arrive from Stripe checkout (idempotent by session
-- id, UNIQUE(kind, ref)); the gateway appends negative 'usage' rows as
-- metered spend draws the balance down. Balance = SUM(amount_cents).
CREATE TABLE IF NOT EXISTS credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  kind text NOT NULL,                    -- purchase | usage | grant
  amount_cents numeric(14,4) NOT NULL,   -- + purchase/grant, - usage
  ref text,                              -- stripe checkout session id (purchases) or note
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, ref)                     -- webhook replays credit a space once
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_space ON credit_ledger (space_id, created_at DESC);
