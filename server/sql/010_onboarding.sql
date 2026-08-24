-- Onboarding: persona + checklist dismissal state, stored per user.
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding jsonb;
