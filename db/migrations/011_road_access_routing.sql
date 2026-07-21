-- 011: carry OSM/editor car-access metadata into the disposable route graph.
-- The feature table keeps these values in its extensible properties JSON;
-- explicit graph columns keep pgRouting's edge query simple and index-free.
BEGIN;

ALTER TABLE road_network_edges
    ADD COLUMN IF NOT EXISTS access TEXT;

ALTER TABLE road_network_edges
    ADD COLUMN IF NOT EXISTS service TEXT;

COMMIT;
