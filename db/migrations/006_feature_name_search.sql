-- Name search uses a leading-wildcard ILIKE, which cannot use a b-tree index.
-- At country scale (millions of features) that is a full scan, so a trigram
-- GIN index makes /api/features/search fast. pg_trgm ships with PostGIS.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_features_name_trgm
  ON features USING gin (name gin_trgm_ops);

COMMIT;
