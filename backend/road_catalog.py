"""Canonical road values and pure validation for editor road changes.

OSM imports can contain uncommon or future ``highway=*`` values, so the
database remains text-based.  Manual edits, however, are constrained to this
catalog at the API boundary: the UI presents the same values as selections and
the backend rejects a newly introduced typo even if a client bypasses the UI.
"""
from typing import Any, Mapping, Optional

ROAD_TYPES = frozenset({
    "motorway", "motorway_link", "trunk", "trunk_link",
    "primary", "primary_link", "secondary", "secondary_link",
    "tertiary", "tertiary_link", "unclassified", "residential",
    "living_street", "service", "track", "pedestrian", "cycleway",
    "footway", "path", "steps",
})

VEHICLE_ROAD_TYPES = ROAD_TYPES - {
    "pedestrian", "cycleway", "footway", "path", "steps",
}

ROAD_DIRECTIONS = frozenset({"bidirectional", "oneway", "oneway_reverse"})

ROAD_SURFACES = frozenset({
    "asphalt", "concrete", "paving_stones", "cobblestone", "compacted",
    "gravel", "fine_gravel", "dirt", "ground", "unpaved",
})

ROUTING_ACCESS_VALUES = frozenset({"yes", "destination", "private", "no"})


class RoadValueError(ValueError):
    """A user-supplied road routing value is missing or unsupported."""


def validate_road_values(
    feature_type: Optional[str],
    road_type: Optional[str],
    properties: Optional[Mapping[str, Any]],
    *,
    direction: Optional[str] = None,
    lane_count: Optional[int] = None,
    max_speed: Optional[int] = None,
    surface: Optional[str] = None,
    previous_road_type: Optional[str] = None,
    previous_direction: Optional[str] = None,
    previous_max_speed: Optional[int] = None,
    previous_surface: Optional[str] = None,
) -> None:
    """Validate a road edit without depending on FastAPI or the database.

    OSM may introduce uncommon ``highway=*`` values outside this editor's
    catalog. An unchanged value can round-trip, while every newly selected
    value must be in the controlled catalog.
    """
    if feature_type != "road":
        return
    if not road_type:
        raise RoadValueError("Road class is required for a road")
    if road_type != previous_road_type and road_type not in ROAD_TYPES:
        raise RoadValueError(f"Unsupported road class: {road_type}")
    routing_access = (properties or {}).get("routing_access")
    if routing_access not in (None, "") and routing_access not in ROUTING_ACCESS_VALUES:
        raise RoadValueError(f"Unsupported road access: {routing_access}")
    if direction and direction != previous_direction and direction not in ROAD_DIRECTIONS:
        raise RoadValueError(f"Unsupported road direction: {direction}")
    if lane_count is not None and not 1 <= lane_count <= 8:
        raise RoadValueError("Road lanes must be between 1 and 8")
    if surface and surface != previous_surface and surface not in ROAD_SURFACES:
        raise RoadValueError(f"Unsupported road surface: {surface}")
    if max_speed is not None and not 1 <= max_speed <= 200:
        raise RoadValueError("Road speed must be between 1 and 200 km/h")
    if (
        road_type in ROAD_TYPES
        and road_type not in VEHICLE_ROAD_TYPES
        and max_speed is not None
        and max_speed != previous_max_speed
    ):
        raise RoadValueError("Speed is only available for vehicle road classes")
