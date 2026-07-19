-- 007: multi-user editor auth + per-feature audit.
-- Adds the users table that backs app-level login (rule D1: migrations are the
-- only schema authority) and the created_by/updated_by audit columns on
-- features. Idempotent so a re-run is a no-op.
BEGIN;

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(64) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Who created / last edited each feature. ON DELETE SET NULL so removing a user
-- never deletes their features; deactivate a user instead to keep the trail.
ALTER TABLE features
    ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

COMMIT;
