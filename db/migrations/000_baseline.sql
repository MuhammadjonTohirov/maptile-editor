-- Baseline bootstrap: creates everything a fresh database needs so that
-- db/migrations/ is the only schema authority (rule D1). Idempotent on
-- databases that were bootstrapped by the retired db/init scripts (rule D2).
BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS features (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    description TEXT,
    geometry GEOMETRY(GEOMETRY, 4326),
    properties JSONB DEFAULT '{}',
    building_number VARCHAR(50),
    building_type VARCHAR(100),
    icon VARCHAR(100),
    osm_id VARCHAR(50),
    osm_type VARCHAR(16),
    source_kind VARCHAR(32) NOT NULL DEFAULT 'manual',
    feature_type VARCHAR(64),
    height_m DOUBLE PRECISION,
    road_type VARCHAR(100),
    direction VARCHAR(20),
    lane_count INTEGER,
    max_speed INTEGER,
    surface VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_features_geometry ON features USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_features_osm_id ON features (osm_id);
CREATE INDEX IF NOT EXISTS idx_features_road_type ON features (road_type);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

CREATE OR REPLACE TRIGGER update_features_updated_at
    BEFORE UPDATE ON features
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMIT;
