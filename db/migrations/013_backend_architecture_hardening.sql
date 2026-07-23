-- 013: durable bulk-job state, API geometry invariants, and hstore ownership.
BEGIN;

-- Bulk transforms use hstore, so installation belongs to migrations rather
-- than an application-triggered data script.
CREATE EXTENSION IF NOT EXISTS hstore;

CREATE TABLE IF NOT EXISTS bulk_load_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    status TEXT NOT NULL DEFAULT 'idle'
        CHECK (status IN ('idle', 'running', 'done', 'error')),
    stage TEXT,
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    message TEXT NOT NULL DEFAULT '',
    error TEXT,
    counts JSONB,
    country TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO bulk_load_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Existing deployments may contain historical invalid geometry. NOT VALID
-- preserves those rows while enforcing the invariant for every new write.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'features_geometry_kind_check'
          AND conrelid = 'features'::regclass
    ) THEN
        ALTER TABLE features
        ADD CONSTRAINT features_geometry_kind_check CHECK (
            geometry IS NULL
            OR feature_type IS NULL
            OR (
                feature_type IN ('point', 'poi', 'business', 'streetlight', 'traffic_light')
                AND ST_GeometryType(geometry) = 'ST_Point'
            )
            OR (
                feature_type IN ('line', 'road', 'waterway')
                AND ST_GeometryType(geometry) IN ('ST_LineString', 'ST_MultiLineString')
            )
            OR (
                feature_type IN ('area', 'building', 'landuse', 'park', 'water', 'forest', 'grass')
                AND ST_GeometryType(geometry) IN ('ST_Polygon', 'ST_MultiPolygon')
            )
            OR feature_type = 'manual'
        ) NOT VALID;
    END IF;
END
$$;

COMMIT;
