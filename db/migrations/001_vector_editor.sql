BEGIN;

ALTER TABLE features
  ADD COLUMN IF NOT EXISTS source_kind VARCHAR(32) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS feature_type VARCHAR(64),
  ADD COLUMN IF NOT EXISTS height_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS osm_type VARCHAR(16);

UPDATE features
SET source_kind = CASE
  WHEN properties ->> 'source' = 'openstreetmap' THEN 'osm_import'
  ELSE 'manual'
END
WHERE source_kind IS NULL OR source_kind = 'manual';

UPDATE features
SET feature_type = NULLIF(properties ->> 'feature_type', '')
WHERE feature_type IS NULL;

UPDATE features
SET height_m = NULLIF(regexp_replace(COALESCE(properties ->> 'height', ''), '[^0-9.]', '', 'g'), '')::DOUBLE PRECISION
WHERE height_m IS NULL
  AND COALESCE(properties ->> 'height', '') ~ '[0-9]';

UPDATE features
SET osm_type = CASE
  WHEN source_kind <> 'osm_import' THEN NULL
  WHEN feature_type IN ('streetlight', 'traffic_light') THEN 'node'
  ELSE 'way'
END
WHERE osm_type IS NULL AND osm_id IS NOT NULL;

ALTER TABLE features
  DROP CONSTRAINT IF EXISTS features_source_kind_check;
ALTER TABLE features
  ADD CONSTRAINT features_source_kind_check CHECK (source_kind IN ('manual', 'osm_import'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_features_osm_identity
  ON features (osm_type, osm_id)
  WHERE osm_type IS NOT NULL AND osm_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_features_source_kind ON features (source_kind);
CREATE INDEX IF NOT EXISTS idx_features_feature_type ON features (feature_type);

COMMIT;
