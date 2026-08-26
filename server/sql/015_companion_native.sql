-- Phase 3: native desktop teaching. teach_tasks grows a kind
-- ('browser' | 'native') plus the native demo fields.
ALTER TABLE teach_tasks ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'browser';
ALTER TABLE teach_tasks ADD COLUMN IF NOT EXISTS app text;       -- app name / .desktop id to launch (native)
ALTER TABLE teach_tasks ADD COLUMN IF NOT EXISTS element text;   -- element to point at: "role:name" substring (native)
