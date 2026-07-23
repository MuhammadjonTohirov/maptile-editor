"""Pure route geometry assembly and human-readable maneuver derivation."""
from __future__ import annotations

import math
from typing import Any, Optional


def route_traversals(rows: list[Any]) -> list[dict[str, int]]:
    """Attach each traversed edge to the node reached after that edge."""
    steps = []
    for index, row in enumerate(rows[:-1]):
        if row.edge == -1:
            continue
        steps.append({
            "path_seq": int(row.path_seq),
            "node": int(row.node),
            "next_node": int(rows[index + 1].node),
            "edge": int(row.edge),
        })
    return steps


def append_coordinate(
    coordinates: list[list[float]],
    coordinate: list[float],
) -> None:
    point = [float(coordinate[0]), float(coordinate[1])]
    # Edge geometries are stored at nine-decimal precision while
    # ST_ClosestPoint can retain extra floating-point digits. Treat sub-mm
    # representation noise as the same join.
    if not coordinates or any(
        abs(previous - current) > 1e-9
        for previous, current in zip(coordinates[-1], point)
    ):
        coordinates.append(point)


def append_linestring(
    coordinates: list[list[float]],
    geometry: dict[str, Any],
) -> None:
    if geometry.get("type") != "LineString":
        raise ValueError("route segment is not a LineString")
    for coordinate in geometry.get("coordinates", []):
        append_coordinate(coordinates, coordinate)


def finish_at_coordinate(
    coordinates: list[list[float]],
    coordinate: list[float],
) -> None:
    """End at the caller's coordinate exactly, even across rounding noise."""
    point = [float(coordinate[0]), float(coordinate[1])]
    if coordinates and coordinates[-1] != point and all(
        abs(previous - current) <= 1e-9
        for previous, current in zip(coordinates[-1], point)
    ):
        coordinates[-1] = point
    else:
        append_coordinate(coordinates, point)


def _bearing_degrees(start: list[float], end: list[float]) -> float:
    """Initial compass bearing from one WGS84 coordinate to another."""
    lng1, lat1 = map(math.radians, start)
    lng2, lat2 = map(math.radians, end)
    delta_lng = lng2 - lng1
    y = math.sin(delta_lng) * math.cos(lat2)
    x = (
        math.cos(lat1) * math.sin(lat2)
        - math.sin(lat1) * math.cos(lat2) * math.cos(delta_lng)
    )
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def _start_bearing(coordinates: list[list[float]]) -> Optional[float]:
    for index in range(1, len(coordinates)):
        if coordinates[index] != coordinates[0]:
            return _bearing_degrees(coordinates[0], coordinates[index])
    return None


def _end_bearing(coordinates: list[list[float]]) -> Optional[float]:
    for index in range(len(coordinates) - 2, -1, -1):
        if coordinates[index] != coordinates[-1]:
            return _bearing_degrees(coordinates[index], coordinates[-1])
    return None


def turn_maneuver(
    incoming_bearing: Optional[float],
    outgoing_bearing: Optional[float],
) -> str:
    """Classify a signed change of bearing into a concise UI maneuver."""
    if incoming_bearing is None or outgoing_bearing is None:
        return "straight"
    delta = (outgoing_bearing - incoming_bearing + 540.0) % 360.0 - 180.0
    magnitude = abs(delta)
    if magnitude >= 150.0:
        return "uturn"
    if magnitude < 25.0:
        return "straight"
    if magnitude < 60.0:
        return "slight_right" if delta > 0 else "slight_left"
    return "right" if delta > 0 else "left"


def _same_route_road(
    previous: dict[str, Any],
    current: dict[str, Any],
) -> bool:
    if previous["feature_id"] == current["feature_id"]:
        return True
    previous_name = previous.get("road_name")
    current_name = current.get("road_name")
    return bool(
        previous_name
        and current_name
        and previous_name.casefold() == current_name.casefold()
    )


def route_steps_for(
    segments: list[dict[str, Any]],
    start_coordinate: list[float],
    end_coordinate: list[float],
    start_access_m: float,
    end_access_m: float,
) -> list[dict[str, Any]]:
    """Group graph edges into named road legs and derive turn maneuvers."""
    groups: list[dict[str, Any]] = []
    for segment in segments:
        road_name = str(segment.get("road_name") or "").strip() or None
        current = {
            "feature_id": int(segment["feature_id"]),
            "road_name": road_name,
            "coordinates": [
                list(position)
                for position in segment["coordinates"]
            ],
            "distance_m": float(segment["distance_m"]),
        }
        if groups and _same_route_road(groups[-1], current):
            for coordinate in current["coordinates"]:
                append_coordinate(groups[-1]["coordinates"], coordinate)
            groups[-1]["distance_m"] += current["distance_m"]
        else:
            groups.append(current)

    steps: list[dict[str, Any]] = []
    for index, group in enumerate(groups):
        maneuver = "depart" if index == 0 else turn_maneuver(
            _end_bearing(groups[index - 1]["coordinates"]),
            _start_bearing(group["coordinates"]),
        )
        steps.append({
            "maneuver": maneuver,
            "coordinate": (
                [float(start_coordinate[0]), float(start_coordinate[1])]
                if index == 0
                else group["coordinates"][0]
            ),
            "road_name": group["road_name"],
            "distance_m": (
                group["distance_m"]
                + (start_access_m if index == 0 else 0.0)
            ),
        })

    if not steps:
        steps.append({
            "maneuver": "depart",
            "coordinate": [
                float(start_coordinate[0]),
                float(start_coordinate[1]),
            ],
            "road_name": None,
            "distance_m": float(start_access_m),
        })
    steps.append({
        "maneuver": "arrive",
        "coordinate": [float(end_coordinate[0]), float(end_coordinate[1])],
        "road_name": None,
        "distance_m": float(end_access_m),
    })
    return steps
