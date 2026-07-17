-- Deleting a local copy of a basemap object keeps the row as a tombstone so
-- the read-only basemap original stays hidden from the map.
BEGIN;

ALTER TABLE features
  DROP CONSTRAINT IF EXISTS features_source_kind_check;
ALTER TABLE features
  ADD CONSTRAINT features_source_kind_check
  CHECK (source_kind IN ('manual', 'osm_import', 'base_tombstone'));

COMMIT;
