-- A road's name is its street title; the map labels only real titles.
-- Earlier OSM imports fabricated placeholder names from the highway type
-- ("Service Road", "Footway Road"), which rendered as meaningless labels.
-- Clear the fabricated names so unnamed roads stay unlabeled; the importer
-- no longer generates them.
BEGIN;

UPDATE features
SET name = ''
WHERE feature_type = 'road'
  AND source_kind = 'osm_import'
  AND name = initcap(road_type) || ' Road';

COMMIT;
