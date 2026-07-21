-- 009: pgRouting network table for the editor's route-finding service.
-- Schema only (rule D1) — the table is populated/rebuilt by
-- scripts/build-road-network.sql, run on demand from the admin panel, never
-- from here. road_network_edges is a derived, disposable copy of the
-- features table's roads (noded so real junctions — including a road ending
-- in the middle of another one — become shared graph nodes); it is safe to
-- truncate and repopulate at any time. pgr_createTopology adds the
-- companion road_network_edges_vertices_pgr table itself; it does not exist
-- until the first rebuild runs. Idempotent so a re-run is a no-op.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgrouting;

CREATE TABLE IF NOT EXISTS road_network_edges (
    id BIGSERIAL PRIMARY KEY,
    feature_id BIGINT,
    road_type TEXT,
    direction TEXT,
    max_speed INTEGER,
    source BIGINT,
    target BIGINT,
    geom GEOMETRY(LineString, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS road_network_edges_geom_idx ON road_network_edges USING GIST (geom);
CREATE INDEX IF NOT EXISTS road_network_edges_source_idx ON road_network_edges (source);
CREATE INDEX IF NOT EXISTS road_network_edges_target_idx ON road_network_edges (target);

COMMIT;
