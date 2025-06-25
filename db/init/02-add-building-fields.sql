-- Add building-specific columns to features table
ALTER TABLE features 
ADD COLUMN IF NOT EXISTS building_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS building_type VARCHAR(100),
ADD COLUMN IF NOT EXISTS icon VARCHAR(100),
ADD COLUMN IF NOT EXISTS osm_id VARCHAR(50);

-- Add index on osm_id for performance
CREATE INDEX IF NOT EXISTS idx_features_osm_id ON features(osm_id);