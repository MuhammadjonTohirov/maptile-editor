-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create features table for storing map features
CREATE TABLE IF NOT EXISTS features (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    description TEXT,
    geometry GEOMETRY(GEOMETRY, 4326),
    properties JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create spatial index on geometry column
CREATE INDEX IF NOT EXISTS idx_features_geometry ON features USING GIST (geometry);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_features_updated_at 
    BEFORE UPDATE ON features 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();