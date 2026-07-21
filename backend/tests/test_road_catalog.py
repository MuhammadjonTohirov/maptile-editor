import pytest

from road_catalog import RoadValueError, validate_road_values


def test_road_class_is_required_and_constrained():
    with pytest.raises(RoadValueError, match="required"):
        validate_road_values("road", None, {})
    with pytest.raises(RoadValueError, match="secodnary"):
        validate_road_values("road", "secodnary", {})

    validate_road_values("road", "secondary", {"routing_access": "yes"})


def test_unchanged_rare_imported_road_class_can_round_trip():
    validate_road_values("road", "raceway", {}, previous_road_type="raceway")


def test_road_access_is_constrained():
    with pytest.raises(RoadValueError, match="sometimes"):
        validate_road_values("road", "service", {"routing_access": "sometimes"})


def test_non_road_ignores_road_specific_values():
    validate_road_values("waterway", "secodnary", {"routing_access": "sometimes"})


def test_controlled_road_values_are_validated():
    validate_road_values(
        "road", "primary", {"routing_access": "yes"},
        direction="oneway", lane_count=2, max_speed=70, surface="asphalt",
    )
    with pytest.raises(RoadValueError):
        validate_road_values("road", "primary", {}, direction="sideways")
    with pytest.raises(RoadValueError):
        validate_road_values("road", "primary", {}, lane_count=9)
    with pytest.raises(RoadValueError):
        validate_road_values("road", "primary", {}, surface="asphlat")


def test_speed_is_only_newly_set_for_vehicle_road_classes():
    with pytest.raises(RoadValueError):
        validate_road_values("road", "footway", {}, max_speed=30)
    # Existing imported data is preserved by geometry-only edits.
    validate_road_values(
        "road", "footway", {}, max_speed=30, previous_max_speed=30,
        previous_road_type="footway",
    )
