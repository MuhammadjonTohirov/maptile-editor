"""Pure feature-domain validation shared by schemas and persistence services."""
from __future__ import annotations

import math
from typing import Any, Mapping

from shapely.geometry import shape


FEATURE_TYPES = (
    "point",
    "poi",
    "business",
    "streetlight",
    "traffic_light",
    "line",
    "road",
    "waterway",
    "area",
    "building",
    "landuse",
    "park",
    "water",
    "forest",
    "grass",
    "manual",
)

_POINT_FEATURE_TYPES = {"point", "poi", "business", "streetlight", "traffic_light"}
_LINE_FEATURE_TYPES = {"line", "road", "waterway"}
_POLYGON_FEATURE_TYPES = {"area", "building", "landuse", "park", "water", "forest", "grass"}
_SUPPORTED_GEOMETRIES = {
    "Point",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
}


def _finite_coordinates(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return math.isfinite(float(value))
    if isinstance(value, (list, tuple)):
        return bool(value) and all(_finite_coordinates(item) for item in value)
    return False


def validate_geometry_mapping(geometry: Mapping[str, Any]) -> None:
    """Validate the structural invariants every API geometry must satisfy."""
    if not isinstance(geometry, Mapping):
        raise ValueError("geometry must be a GeoJSON object")
    geometry_type = geometry.get("type")
    if geometry_type not in _SUPPORTED_GEOMETRIES:
        raise ValueError(f"unsupported GeoJSON geometry type: {geometry_type}")
    coordinates = geometry.get("coordinates")
    if not _finite_coordinates(coordinates):
        raise ValueError("geometry coordinates must contain only finite numbers")
    try:
        parsed = shape(geometry)
    except Exception as error:
        raise ValueError(f"invalid GeoJSON geometry: {error}") from error
    if parsed.is_empty:
        raise ValueError("geometry must not be empty")
    if not parsed.is_valid:
        raise ValueError("geometry must be valid")
    min_x, min_y, max_x, max_y = parsed.bounds
    if min_x < -180 or max_x > 180 or min_y < -90 or max_y > 90:
        raise ValueError("geometry coordinates must use valid longitude and latitude")


def validate_feature_geometry(feature_type: str | None, geometry: Mapping[str, Any]) -> None:
    """Ensure a feature category uses a geometry the editor can safely handle."""
    validate_geometry_mapping(geometry)
    geometry_type = geometry["type"]
    if feature_type in _POINT_FEATURE_TYPES and geometry_type != "Point":
        raise ValueError(f"{feature_type} features require Point geometry")
    if feature_type in _LINE_FEATURE_TYPES and geometry_type not in {"LineString", "MultiLineString"}:
        raise ValueError(f"{feature_type} features require line geometry")
    if feature_type in _POLYGON_FEATURE_TYPES and geometry_type not in {"Polygon", "MultiPolygon"}:
        raise ValueError(f"{feature_type} features require polygon geometry")
