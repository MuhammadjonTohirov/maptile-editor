-- 008: O(1) change stamp for the client's edit poll.
-- The read-only client polls /api/features/version to know when to reload. That
-- endpoint used count(*) + max(updated_at) over the whole features table — two
-- full scans of ~2.2M rows (~1.5s) on every poll of every open tab. This adds a
-- single-row feature_stat table with a monotonic revision + updated_at, bumped
-- by a STATEMENT-level trigger on any write. The poll then reads one row.
-- Statement-level (not per-row) keeps the bulk load cheap: one bump per INSERT
-- statement, not one per row. A bumped revision also catches deletes of old rows
-- that max(updated_at) alone would miss (rule D1: migrations are the only schema
-- authority). Idempotent so a re-run is a no-op.
BEGIN;

-- Single fixed row (id is always true) holding the current change stamp.
CREATE TABLE IF NOT EXISTS feature_stat (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    revision BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ
);

-- Seed the one row from the current table state; harmless if it already exists.
INSERT INTO feature_stat (id, revision, updated_at)
VALUES (TRUE, 0, (SELECT max(updated_at) FROM features))
ON CONFLICT (id) DO NOTHING;

-- Any write to features bumps the stamp. RETURN NULL: this is an AFTER trigger.
CREATE OR REPLACE FUNCTION bump_feature_stat() RETURNS trigger AS $$
BEGIN
    UPDATE feature_stat SET revision = revision + 1, updated_at = now() WHERE id;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS features_bump_stat ON features;
CREATE TRIGGER features_bump_stat
    AFTER INSERT OR UPDATE OR DELETE ON features
    FOR EACH STATEMENT
    EXECUTE FUNCTION bump_feature_stat();

COMMIT;
