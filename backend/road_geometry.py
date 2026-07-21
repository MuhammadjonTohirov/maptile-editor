"""Pure validation for routable road geometry at the API boundary."""
from __future__ import annotations

import math
from typing import Any, Mapping, Sequence

from shapely.geometry import shape


class RoadGeometryError(ValueError):
    """A road geometry cannot safely be used by the routing builder."""


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


def validate_road_geometry(feature_type: str | None, geometry: Mapping[str, Any]) -> None:
    """Reject malformed and degenerate LineStrings before they reach PostGIS."""
    if feature_type != "road":
        return
    if geometry.get("type") != "LineString":
        raise RoadGeometryError("Road geometry must be a LineString")
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        raise RoadGeometryError("A road needs at least two points")

    positions = [_position(value) for value in coordinates]
    if any(current == previous for previous, current in zip(positions, positions[1:])):
        raise RoadGeometryError("A road cannot contain duplicate consecutive points")

    line = shape({"type": "LineString", "coordinates": positions})
    if line.is_empty or line.length == 0:
        raise RoadGeometryError("A road must have non-zero length")
    if not line.is_valid:
        raise RoadGeometryError("Road geometry is not a valid LineString")
