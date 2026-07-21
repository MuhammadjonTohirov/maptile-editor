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
