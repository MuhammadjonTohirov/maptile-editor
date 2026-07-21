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

ROUTING_ACCESS_VALUES = frozenset({"yes", "destination", "private", "no"})


class RoadValueError(ValueError):
    """A user-supplied road routing value is missing or unsupported."""


def validate_road_values(
    feature_type: Optional[str],
    road_type: Optional[str],
    properties: Optional[Mapping[str, Any]],
    *,
    previous_road_type: Optional[str] = None,
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
