from road_network_builder import (
    MANUAL_JUNCTION_SPLIT_TOLERANCE_DEGREES,
    _INSERT_SEGMENT_BATCH,
)


def test_segment_builder_uses_the_noded_geometry_alias():
    sql = str(_INSERT_SEGMENT_BATCH)
    assert "FROM noded b" in sql
    assert "ST_DumpSegments(b.geom)" in sql
    assert "ST_DumpSegments(b.geometry)" not in sql


def test_segment_builder_snaps_host_line_before_junction_split():
    sql = str(_INSERT_SEGMENT_BATCH)
    assert "ST_Split" in sql
    assert "ST_Snap(b.geometry, blades.geom" in sql
    assert "junction_split_tolerance" in sql
    assert MANUAL_JUNCTION_SPLIT_TOLERANCE_DEGREES == 1e-9


def test_midpoint_junction_only_splits_its_recorded_host_road():
    sql = str(_INSERT_SEGMENT_BATCH)
    assert "WHERE target_feature_id IN (SELECT id FROM road_batch)" in sql
    assert "GROUP BY target_feature_id" in sql
    assert "ST_Split" in sql


def test_controlled_routing_attributes_survive_the_shadow_build():
    sql = str(_INSERT_SEGMENT_BATCH)
    for column in (
        "road_type", "direction", "max_speed", "lane_count", "surface", "access", "service",
    ):
        assert column in sql
