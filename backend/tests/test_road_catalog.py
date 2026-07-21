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
