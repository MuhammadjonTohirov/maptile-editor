-- Transform the GDAL OSM staging tables (schema osm_load) into editor
-- features. The field mapping mirrors backend/osm_import.py's builders so a
-- bulk-loaded feature is indistinguishable from a per-area Overpass import:
-- same feature_type, category columns, icons, and source_kind=osm_import.
-- Idempotent: ON CONFLICT on the OSM identity skips rows already present, so
-- a re-run (or a later per-area import of the same object) never duplicates.
BEGIN;

-- Buildings: multipolygons carrying a building tag. Closed ways expose
-- osm_way_id; multipolygon relations expose osm_id.
INSERT INTO features (
  name, description, geometry, building_number, building_type,
  osm_id, osm_type, source_kind, feature_type, height_m, properties
)
SELECT
  NULLIF(mp.name, ''),
  'Building from OSM (bulk load)',
  mp.geom,
  NULLIF(h -> 'addr:housenumber', ''),
  COALESCE(NULLIF(mp.building, ''), 'yes'),
  COALESCE(mp.osm_id, mp.osm_way_id),
  CASE WHEN mp.osm_id IS NOT NULL THEN 'relation' ELSE 'way' END,
  'osm_import',
  'building',
  substring(h -> 'height' FROM '^[0-9]+\.?[0-9]*')::double precision,
  jsonb_build_object('source', 'openstreetmap', 'osm_tags',
    COALESCE(hstore_to_jsonb(h), '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object('building', mp.building, 'name', mp.name)))
FROM osm_load.multipolygons mp
LEFT JOIN LATERAL (SELECT NULLIF(mp.other_tags, '')::hstore AS h) t ON true
WHERE mp.building IS NOT NULL
  AND mp.geom IS NOT NULL
  AND COALESCE(mp.osm_id, mp.osm_way_id) IS NOT NULL
ON CONFLICT (osm_type, osm_id) WHERE osm_type IS NOT NULL AND osm_id IS NOT NULL
DO NOTHING;

-- Roads: any line with a highway tag. Names come only from OSM's name tag;
-- unnamed roads stay unnamed (no fabricated placeholder), matching _build_road.
INSERT INTO features (
  name, description, geometry, road_type, direction,
  lane_count, max_speed, surface, osm_id, osm_type,
  source_kind, feature_type, properties
)
SELECT
  NULLIF(l.name, ''),
  'Road from OSM (bulk load)',
  l.geom,
  l.highway,
  CASE h -> 'oneway'
    WHEN 'yes' THEN 'oneway'
    WHEN '-1' THEN 'oneway_reverse'
    ELSE 'bidirectional'
  END,
  substring(h -> 'lanes' FROM '^[0-9]+')::integer,
  CASE
    WHEN h -> 'maxspeed' ~ 'mph'
      THEN round(substring(h -> 'maxspeed' FROM '^[0-9]+')::numeric * 1.60934)::integer
    ELSE substring(h -> 'maxspeed' FROM '^[0-9]+')::integer
  END,
  NULLIF(h -> 'surface', ''),
  l.osm_id,
  'way',
  'osm_import',
  'road',
  jsonb_build_object('source', 'openstreetmap', 'feature_type', 'road', 'osm_tags',
    COALESCE(hstore_to_jsonb(h), '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object('highway', l.highway, 'name', l.name)))
FROM osm_load.lines l
LEFT JOIN LATERAL (SELECT NULLIF(l.other_tags, '')::hstore AS h) t ON true
WHERE l.highway IS NOT NULL
  AND l.geom IS NOT NULL
  AND l.osm_id IS NOT NULL
ON CONFLICT (osm_type, osm_id) WHERE osm_type IS NOT NULL AND osm_id IS NOT NULL
DO NOTHING;

-- Street furniture: traffic signals and street lamps. Names and icons mirror
-- _build_traffic_light / _build_streetlight.
INSERT INTO features (
  name, description, geometry, icon, osm_id, osm_type,
  source_kind, feature_type, properties
)
SELECT
  CASE
    WHEN pt.highway = 'traffic_signals'
      THEN 'Traffic Light' || COALESCE(' ' || NULLIF(h -> 'ref', ''), '')
    ELSE 'Street Light (' || COALESCE(h -> 'lamp_type', h -> 'light_source', 'street_lamp') || ')'
  END,
  CASE WHEN pt.highway = 'traffic_signals'
    THEN 'Traffic light from OSM (bulk load)'
    ELSE 'Street light from OSM (bulk load)'
  END,
  pt.geom,
  CASE WHEN pt.highway = 'traffic_signals' THEN '🚦' ELSE '💡' END,
  pt.osm_id,
  'node',
  'osm_import',
  CASE WHEN pt.highway = 'traffic_signals' THEN 'traffic_light' ELSE 'streetlight' END,
  jsonb_build_object('source', 'openstreetmap',
    'feature_type', CASE WHEN pt.highway = 'traffic_signals' THEN 'traffic_light' ELSE 'streetlight' END,
    'osm_tags', COALESCE(hstore_to_jsonb(h), '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object('highway', pt.highway, 'name', pt.name)))
FROM osm_load.points pt
LEFT JOIN LATERAL (SELECT NULLIF(pt.other_tags, '')::hstore AS h) t ON true
WHERE pt.highway IN ('traffic_signals', 'street_lamp')
  AND pt.geom IS NOT NULL
  AND pt.osm_id IS NOT NULL
ON CONFLICT (osm_type, osm_id) WHERE osm_type IS NOT NULL AND osm_id IS NOT NULL
DO NOTHING;

COMMIT;
