import pytest

from road_geometry import RoadGeometryError, split_road_span_geometry, validate_road_geometry


def road(coordinates):
    return {"type": "LineString", "coordinates": coordinates}


def test_valid_road_linestring_is_accepted():
    validate_road_geometry("road", road([[71.77, 40.38], [71.78, 40.39]]))


@pytest.mark.parametrize("geometry", [
    {"type": "Point", "coordinates": [71.77, 40.38]},
    road([[71.77, 40.38]]),
    road([[71.77, 40.38], [71.77, 40.38]]),
    road([[71.77, 40.38], [71.78, 40.39], [71.78, 40.39]]),
    road([[float("nan"), 40.38], [71.78, 40.39]]),
])
def test_invalid_or_zero_length_road_is_rejected(geometry):
    with pytest.raises(RoadGeometryError):
        validate_road_geometry("road", geometry)


def test_non_road_geometry_is_not_constrained_to_linestring():
    validate_road_geometry("point", {"type": "Point", "coordinates": [71.77, 40.38]})


def test_road_span_split_preserves_untouched_prefix_and_suffix():
    parts = split_road_span_geometry(
        road([[0, 0], [1, 0], [2, 0], [3, 0]]),
        [1, 0],
        [2, 0],
    )
    assert parts["prefix"]["coordinates"] == [[0.0, 0.0], [1.0, 0.0]]
    assert parts["selected"]["coordinates"] == [[1.0, 0.0], [2.0, 0.0]]
    assert parts["suffix"]["coordinates"] == [[2.0, 0.0], [3.0, 0.0]]


def test_road_span_split_supports_mid_segment_topology_nodes():
    parts = split_road_span_geometry(road([[0, 0], [3, 0]]), [1, 0], [2, 0])
    assert parts["prefix"]["coordinates"][-1] == [1.0, 0.0]
    assert parts["suffix"]["coordinates"][0] == [2.0, 0.0]


def test_road_span_split_rejects_points_outside_the_stored_road():
    with pytest.raises(RoadGeometryError):
        split_road_span_geometry(road([[0, 0], [3, 0]]), [1, 1], [2, 0])


def test_split_sibling_is_json_native_and_can_reenter_road_validation():
    parts = split_road_span_geometry(
        road([
            [71.7846403, 40.3858594],
            [71.7848155, 40.385931],
            [71.7851776, 40.3860515],
        ]),
        [71.7846403, 40.3858594],
        [71.7848155, 40.385931],
    )

    assert parts["prefix"] is None
    assert parts["suffix"]["coordinates"] == [
        [71.7848155, 40.385931],
        [71.7851776, 40.3860515],
    ]
    validate_road_geometry("road", parts["suffix"])


def test_road_span_split_collapses_precision_remainders_at_stored_endpoints():
    geometry = road([
        [71.7848155, 40.385931],
        [71.7851776, 40.3860515],
    ])

    from_near_start = split_road_span_geometry(
        geometry,
        [71.784815703, 40.385931068],
        [71.7850, 40.3859924],
    )
    assert from_near_start["prefix"] is None

    to_near_end = split_road_span_geometry(
        geometry,
        [71.7850, 40.3859924],
        [71.7851774, 40.386051433],
    )
    assert to_near_end["suffix"] is None


def test_road_span_split_rejects_precision_sliver_at_canonical_endpoint():
    with pytest.raises(RoadGeometryError, match="zero length"):
        split_road_span_geometry(
            road([
                [71.7848155, 40.385931],
                [71.784815703, 40.385931068],
            ]),
            [71.78481570176561, 40.385931067586505],
            [71.784815703, 40.385931068],
        )
