-- Phase 4: agent-driven computer use. teach_tasks grows a 'cua' kind whose
-- exact operation travels in `op` (jsonb) and whose structured result
-- (annotated element list, screenshot metadata) comes back in `result_data`
-- so the agent tool can relay it to the model without parsing prose.
ALTER TABLE teach_tasks ADD COLUMN IF NOT EXISTS op jsonb;
ALTER TABLE teach_tasks ADD COLUMN IF NOT EXISTS result_data jsonb;
