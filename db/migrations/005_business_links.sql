-- Businesses are point features registered inside a building: feature_type
-- 'business', a business_type category column, and a building_id link to the
-- building feature. Several businesses can link to one building. Deleting the
-- building keeps its businesses as free-standing POIs (SET NULL).
BEGIN;

ALTER TABLE features ADD COLUMN IF NOT EXISTS business_type VARCHAR(100);
ALTER TABLE features ADD COLUMN IF NOT EXISTS building_id INTEGER REFERENCES features(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_features_building_id ON features (building_id) WHERE building_id IS NOT NULL;

COMMIT;
