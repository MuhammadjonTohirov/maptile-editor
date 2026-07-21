-- 010: upgrade pgRouting and make routing topology application-owned.
--
-- pgRouting 4 removes pgr_nodeNetwork and pgr_createTopology. The application
-- now builds graph edges from the vertices already encoded in each OSM way,
-- and publishes a completed shadow graph atomically. This migration owns only
-- the stable tables; disposable *_next/build tables are created by the builder.
BEGIN;

DO $$
DECLARE
    installed_version text;
BEGIN
    SELECT extversion INTO installed_version
    FROM pg_extension
    WHERE extname = 'pgrouting';

    IF installed_version IS NULL THEN
        CREATE EXTENSION pgrouting VERSION '4.0.1';
    ELSIF installed_version <> '4.0.1' THEN
        EXECUTE 'ALTER EXTENSION pgrouting UPDATE TO ''4.0.1''';
    END IF;
END
$$;

-- pgRouting 4 expects applications to own their vertex table and source /
-- target assignments. Exact x/y columns make shared OSM node coordinates a
-- cheap indexed identity instead of requiring all-to-all geometry comparison.
CREATE TABLE IF NOT EXISTS road_network_vertices (
    id BIGINT PRIMARY KEY,
    x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL,
    the_geom GEOMETRY(Point, 4326) NOT NULL,
    UNIQUE (x, y)
);

CREATE INDEX IF NOT EXISTS road_network_vertices_geom_idx
    ON road_network_vertices USING GIST (the_geom);

CREATE INDEX IF NOT EXISTS road_network_edges_feature_idx
    ON road_network_edges (feature_id);

-- Progress survives page refreshes and backend restarts. published_at is kept
-- while a later rebuild runs, so the previously committed graph stays usable.
CREATE TABLE IF NOT EXISTS road_network_build_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    status TEXT NOT NULL DEFAULT 'idle'
        CHECK (status IN ('idle', 'running', 'done', 'error')),
    phase TEXT,
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    roads_total BIGINT NOT NULL DEFAULT 0,
    roads_processed BIGINT NOT NULL DEFAULT 0,
    segments_total BIGINT NOT NULL DEFAULT 0,
    segments_processed BIGINT NOT NULL DEFAULT 0,
    vertices_count BIGINT NOT NULL DEFAULT 0,
    edge_count BIGINT,
    published_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    error TEXT
);

INSERT INTO road_network_build_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

COMMIT;
