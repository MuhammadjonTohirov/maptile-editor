"""Pure validation for routable road geometry at the API boundary."""
from __future__ import annotations

import math
from typing import Any, Mapping, Sequence

from shapely.geometry import Point, shape
from shapely.ops import substring


class RoadGeometryError(ValueError):
    """A road geometry cannot safely be used by the routing builder."""


ROAD_SPAN_NODE_TOLERANCE_M = 0.5
METRES_PER_LATITUDE_DEGREE = 111_320.0


def _position(value: Any) -> tuple[float, float]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)) or len(value) < 2:
        raise RoadGeometryError("Road coordinates must be longitude/latitude pairs")
    lng, lat = value[0], value[1]
    if isinstance(lng, bool) or isinstance(lat, bool):
        raise RoadGeometryError("Road coordinates must be finite numbers")
    try:
        lng, lat = float(lng), float(lat)
    except (TypeError, ValueError) as error:
        raise RoadGeometryError("Road coordinates must be finite numbers") from error
    if not math.isfinite(lng) or not math.isfinite(lat):
        raise RoadGeometryError("Road coordinates must be finite numbers")
    if not -180 <= lng <= 180 or not -90 <= lat <= 90:
        raise RoadGeometryError("Road coordinates are outside longitude/latitude limits")
    return lng, lat


def _distance_metres(left: Point, right: Point) -> float:
    """Small-distance WGS84 approximation used only for node canonicalization."""
    average_latitude = math.radians((left.y + right.y) / 2)
    east = (left.x - right.x) * math.cos(average_latitude) * METRES_PER_LATITUDE_DEGREE
    north = (left.y - right.y) * METRES_PER_LATITUDE_DEGREE
    return math.hypot(east, north)


def validate_road_geometry(feature_type: str | None, geometry: Mapping[str, Any]) -> None:
    """Reject malformed and degenerate LineStrings before they reach PostGIS."""
    if feature_type != "road":
        return
    if geometry.get("type") != "LineString":
        raise RoadGeometryError("Road geometry must be a LineString")
    coordinates = geometry.get("coordinates")
    if (
        not isinstance(coordinates, Sequence)
        or isinstance(coordinates, (str, bytes))
        or len(coordinates) < 2
    ):
        raise RoadGeometryError("A road needs at least two points")

    positions = [_position(value) for value in coordinates]
    if any(current == previous for previous, current in zip(positions, positions[1:])):
        raise RoadGeometryError("A road cannot contain duplicate consecutive points")

    line = shape({"type": "LineString", "coordinates": positions})
    if line.is_empty or line.length == 0:
        raise RoadGeometryError("A road must have non-zero length")
    if not line.is_valid:
        raise RoadGeometryError("Road geometry is not a valid LineString")


def split_road_span_geometry(
    geometry: Mapping[str, Any],
    start: Sequence[float],
    end: Sequence[float],
    tolerance: float = 1e-8,
) -> dict[str, dict[str, Any] | None]:
    """Return the untouched prefix/selected/suffix around one road span.

    The frontend sends the original topology-node coordinates, not edited
    endpoints. Projecting those two points onto the authoritative stored line
    makes the operation safe against clipped or quantized vector-tile data.
    """
    validate_road_geometry("road", geometry)
    line = shape(geometry)
    start_point = Point(_position(start))
    end_point = Point(_position(end))
    if line.distance(start_point) > tolerance or line.distance(end_point) > tolerance:
        raise RoadGeometryError("Selected road span is not on the stored road")
    start_distance = line.project(start_point)
    end_distance = line.project(end_point)

    # Projected manual junctions can differ from a stored road endpoint by a
    # few centimetres after browser/PostGIS precision round-trips. Treat those
    # as the same topology node so a segment mutation cannot retain a tiny
    # prefix/suffix which becomes an independently editable road.
    line_start = Point(line.coords[0])
    line_end = Point(line.coords[-1])

    def canonical_boundary(distance: float) -> float:
        projected = line.interpolate(distance)
        if _distance_metres(projected, line_start) <= ROAD_SPAN_NODE_TOLERANCE_M:
            return 0.0
        if _distance_metres(projected, line_end) <= ROAD_SPAN_NODE_TOLERANCE_M:
            return line.length
        return distance

    start_distance = canonical_boundary(start_distance)
    end_distance = canonical_boundary(end_distance)
    if end_distance - start_distance <= tolerance:
        raise RoadGeometryError("Selected road span has invalid direction or zero length")

    def part(from_distance: float, to_distance: float) -> dict[str, Any] | None:
        if to_distance - from_distance <= tolerance:
            return None
        geometry_part = substring(line, from_distance, to_distance)
        if geometry_part.geom_type != "LineString" or geometry_part.length <= tolerance:
            return None
        # Shapely coordinate sequences yield tuples. Return a JSON-native
        # GeoJSON value because this result immediately re-enters the API road
        # validator when untouched siblings are materialized.
        return {
            "type": "LineString",
            "coordinates": [list(position) for position in geometry_part.coords],
        }

    return {
        "prefix": part(0.0, start_distance),
        "selected": part(start_distance, end_distance),
        "suffix": part(end_distance, line.length),
    }
