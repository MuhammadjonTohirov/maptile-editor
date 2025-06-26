-- Add road-specific columns to features table
ALTER TABLE features 
ADD COLUMN IF NOT EXISTS road_type VARCHAR(100),
ADD COLUMN IF NOT EXISTS direction VARCHAR(20),
ADD COLUMN IF NOT EXISTS lane_count INTEGER,
ADD COLUMN IF NOT EXISTS max_speed INTEGER,
ADD COLUMN IF NOT EXISTS surface VARCHAR(50);

-- Add index on road_type for performance
CREATE INDEX IF NOT EXISTS idx_features_road_type ON features(road_type);