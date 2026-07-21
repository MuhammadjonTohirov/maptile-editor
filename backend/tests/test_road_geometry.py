import pytest

from road_geometry import RoadGeometryError, validate_road_geometry


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
