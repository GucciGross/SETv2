-- User-creatable copilot mascot (OpenMausBot / Grok-bot inspired desk pet)
ALTER TABLE users ADD COLUMN IF NOT EXISTS mascot jsonb;
