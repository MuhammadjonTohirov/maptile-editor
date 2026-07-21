-- 012: durable road-source revisions and routing attribute parity.
--
-- Every statement that changes at least one road increments source_revision.
-- The published graph stays usable while stale or while a shadow rebuild runs;
-- publication clears stale only when no road changed during that rebuild.
BEGIN;

ALTER TABLE road_network_build_state
    ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS source_revision BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS published_revision BIGINT,
    ADD COLUMN IF NOT EXISTS build_source_revision BIGINT,
    ADD COLUMN IF NOT EXISTS source_changed_at TIMESTAMPTZ;

ALTER TABLE road_network_edges
    ADD COLUMN IF NOT EXISTS lane_count INTEGER,
    ADD COLUMN IF NOT EXISTS surface TEXT,
    ADD COLUMN IF NOT EXISTS access TEXT,
    ADD COLUMN IF NOT EXISTS service TEXT;

CREATE OR REPLACE FUNCTION mark_road_network_stale_after_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM new_roads WHERE feature_type = 'road') THEN
        UPDATE road_network_build_state
        SET is_stale = TRUE,
            source_revision = source_revision + 1,
            source_changed_at = now(),
            updated_at = now()
        WHERE id = 1;
    END IF;
    RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION mark_road_network_stale_after_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM old_roads old_row
        FULL JOIN new_roads new_row USING (id)
        WHERE old_row.feature_type = 'road' OR new_row.feature_type = 'road'
    ) THEN
        UPDATE road_network_build_state
        SET is_stale = TRUE,
            source_revision = source_revision + 1,
            source_changed_at = now(),
            updated_at = now()
        WHERE id = 1;
    END IF;
    RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION mark_road_network_stale_after_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM old_roads WHERE feature_type = 'road') THEN
        UPDATE road_network_build_state
        SET is_stale = TRUE,
            source_revision = source_revision + 1,
            source_changed_at = now(),
            updated_at = now()
        WHERE id = 1;
    END IF;
    RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS features_road_network_stale_insert ON features;
CREATE TRIGGER features_road_network_stale_insert
AFTER INSERT ON features
REFERENCING NEW TABLE AS new_roads
FOR EACH STATEMENT EXECUTE FUNCTION mark_road_network_stale_after_insert();

DROP TRIGGER IF EXISTS features_road_network_stale_update ON features;
CREATE TRIGGER features_road_network_stale_update
AFTER UPDATE ON features
REFERENCING OLD TABLE AS old_roads NEW TABLE AS new_roads
FOR EACH STATEMENT EXECUTE FUNCTION mark_road_network_stale_after_update();

DROP TRIGGER IF EXISTS features_road_network_stale_delete ON features;
CREATE TRIGGER features_road_network_stale_delete
AFTER DELETE ON features
REFERENCING OLD TABLE AS old_roads
FOR EACH STATEMENT EXECUTE FUNCTION mark_road_network_stale_after_delete();

COMMIT;
