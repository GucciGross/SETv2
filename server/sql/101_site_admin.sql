-- Site-admin flag for private-preview team onboarding.
-- Additive and default-off: nobody is a site admin until the operator
-- explicitly promotes a user by id (never via registration or the API).
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_site_admin boolean NOT NULL DEFAULT false;
