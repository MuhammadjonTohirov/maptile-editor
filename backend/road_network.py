"""pgRouting route queries and the application-owned topology build facade.

pgRouting 4 no longer mutates edge tables to create topology. The batched
builder lives in road_network_builder.py; this module keeps profile costing and
route assembly together while exposing the small build API used by the router.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

import road_network_builder
from config import ROUTE_STATEMENT_TIMEOUT_MS
from route_result import (
    append_coordinate,
    append_linestring,
    finish_at_coordinate,
    route_steps_for,
    route_traversals,
    turn_maneuver,
)


@dataclass(frozen=True)
class RoutePoint:
    """A requested coordinate projected onto one usable graph edge.

    pgRouting represents points on edges as negative vertex ids. ``pid`` stays
    positive in the points query, while ``vid`` is the corresponding virtual
    vertex used as the route endpoint.
    """

    pid: int
    edge_id: int
    fraction: float
    snapped_lng: float
    snapped_lat: float
    access_m: float

    @property
    def vid(self) -> int:
        return -self.pid


# A connector from a clicked building/location to its nearest usable road is
# off-network. Count that short access leg at walking speed for every profile
# instead of pretending that a car can drive through a building or courtyard.
ACCESS_LEG_SPEED_MPS = 5000 / 3600


def _car_speed_kph_sql(column_prefix: str = "") -> str:
    return f"""GREATEST(COALESCE({column_prefix}max_speed, CASE {column_prefix}road_type
    WHEN 'motorway' THEN 90 WHEN 'motorway_link' THEN 50
    WHEN 'trunk' THEN 80 WHEN 'trunk_link' THEN 45
    WHEN 'primary' THEN 60 WHEN 'primary_link' THEN 40
    WHEN 'secondary' THEN 50 WHEN 'secondary_link' THEN 35
    WHEN 'tertiary' THEN 40 WHEN 'tertiary_link' THEN 30
    WHEN 'residential' THEN 30 WHEN 'unclassified' THEN 30
    WHEN 'living_street' THEN 10 WHEN 'service' THEN 20
    WHEN 'track' THEN 10 ELSE 30 END), 5)"""


CAR_SPEED_KPH_SQL = _car_speed_kph_sql()

# Cost is travel time multiplied by road preference. Physical duration is
# calculated separately after Dijkstra, so preferring an arterial does not
# inflate the ETA shown to the user.
CAR_COST_SQL = f"""(ST_Length(geom::geography) /
    ({CAR_SPEED_KPH_SQL} * 1000.0 / 3600.0)) *
    (CASE road_type
        WHEN 'motorway' THEN 1.00 WHEN 'trunk' THEN 1.00
        WHEN 'primary' THEN 1.00 WHEN 'secondary' THEN 1.05
        WHEN 'tertiary' THEN 1.12 WHEN 'unclassified' THEN 1.20
        WHEN 'residential' THEN 1.25 WHEN 'living_street' THEN 1.80
        WHEN 'service' THEN 2.50 WHEN 'track' THEN 4.00
        WHEN 'motorway_link' THEN 1.08 WHEN 'trunk_link' THEN 1.08
        WHEN 'primary_link' THEN 1.08 WHEN 'secondary_link' THEN 1.10
        WHEN 'tertiary_link' THEN 1.12 ELSE 1.40 END) *
    (CASE WHEN access = 'destination' THEN 1.40 ELSE 1.00 END) *
    (CASE WHEN service IN ('driveway', 'parking_aisle', 'alley') THEN 1.60 ELSE 1.00 END)"""

CAR_TRAVEL_TIME_SQL = (
    f"ST_Length(geom::geography) / ({CAR_SPEED_KPH_SQL} * 1000.0 / 3600.0)"
)

# Route reconstruction also joins the source feature to retrieve its display
# name. Qualify every segment column there because features intentionally
# carries similarly named road attributes such as max_speed.
CAR_SEGMENT_TRAVEL_TIME_SQL = (
    "ST_Length(segments.geom::geography) / "
    f"({_car_speed_kph_sql('segments.')} * 1000.0 / 3600.0)"
)

# Per-profile road accessibility + cost. car respects the digitized oneway
# direction (direction='oneway'/'oneway_reverse'); foot/bicycle ignore it,
# matching real-world routing convention (pedestrians and cyclists are
# rarely bound by a one-way restriction the way a car is).
PROFILES: dict[str, dict[str, Any]] = {
    "foot": {
        "exclude": ("motorway", "motorway_link", "trunk", "trunk_link"),
        "cost": "ST_Length(geom::geography)",
        "directed": False,
        "speed_mps": 5000 / 3600,
    },
    "bicycle": {
        "exclude": ("motorway", "motorway_link", "trunk", "trunk_link", "steps"),
        "cost": "ST_Length(geom::geography)",
        "directed": False,
        "speed_mps": 15000 / 3600,
    },
    "car": {
        "exclude": (
            "footway", "path", "steps", "pedestrian", "bridleway", "cycleway", "corridor", "platform",
        ),
        "cost": CAR_COST_SQL,
        "access": "(access IS NULL OR access NOT IN ('no', 'private'))",
        "directed": True,
    },
}


async def status(db: AsyncSession) -> dict[str, Any]:
    return await road_network_builder.status(db)


async def start() -> None:
    await road_network_builder.start()


async def network_ready(db: AsyncSession) -> bool:
    result = await db.execute(text(
        "SELECT published_at IS NOT NULL FROM road_network_build_state WHERE id = 1"
    ))
    return bool(result.scalar_one())


async def network_state(db: AsyncSession) -> dict[str, bool]:
    row = (await db.execute(text(
        "SELECT published_at IS NOT NULL AS ready, is_stale "
        "FROM road_network_build_state WHERE id = 1"
    ))).one()
    return {"ready": bool(row.ready), "is_stale": bool(row.is_stale)}


def _excluded_sql(profile: str) -> str:
    return ", ".join(f"'{road_type}'" for road_type in PROFILES[profile]["exclude"])


def _where_sql(profile: str) -> str:
    spec = PROFILES[profile]
    clauses = [f"road_type NOT IN ({_excluded_sql(profile)})"]
    if spec.get("access"):
        clauses.append(spec["access"])
    return " AND ".join(clauses)


async def _nearest_edge_point(
    db: AsyncSession, lng: float, lat: float, profile: str, pid: int,
) -> Optional[RoutePoint]:
    # Project onto the nearest edge allowed for this profile. The fraction is
    # passed to pgr_withPoints so routing begins at that exact location on the
    # edge rather than at one of its (potentially distant) endpoint vertices.
    result = await db.execute(text(
        "WITH input AS ("
        "SELECT ST_SetSRID(ST_MakePoint(:lng, :lat), 4326) AS geom"
        "), nearest AS ("
        "SELECT edge.id AS edge_id, edge.geom, input.geom AS requested_geom "
        "FROM input CROSS JOIN LATERAL ("
        "SELECT id, geom FROM road_network_edges "
        f"WHERE {_where_sql(profile)} "
        "ORDER BY geom <-> input.geom LIMIT 1"
        ") edge"
        "), located AS ("
        "SELECT edge_id, requested_geom, "
        "ST_LineLocatePoint(geom, requested_geom) AS fraction, "
        "ST_ClosestPoint(geom, requested_geom)::geometry(Point, 4326) AS snapped_geom "
        "FROM nearest"
        ") SELECT edge_id, fraction, ST_X(snapped_geom) AS snapped_lng, "
        "ST_Y(snapped_geom) AS snapped_lat, "
        "ST_Distance(requested_geom::geography, snapped_geom::geography) AS access_m "
        "FROM located"
    ), {"lng": lng, "lat": lat})
    row = result.first()
    if row is None:
        return None
    return RoutePoint(
        pid=pid,
        edge_id=int(row.edge_id),
        fraction=min(1.0, max(0.0, float(row.fraction))),
        snapped_lng=float(row.snapped_lng),
        snapped_lat=float(row.snapped_lat),
        access_m=float(row.access_m),
    )


def points_sql_for(start: RoutePoint, end: RoutePoint) -> str:
    """Build pgRouting's fixed points query from database-derived values."""
    if start.pid <= 0 or end.pid <= 0 or start.pid == end.pid:
        raise ValueError("route point ids must be distinct positive integers")
    for point in (start, end):
        if point.edge_id <= 0 or not 0.0 <= point.fraction <= 1.0:
            raise ValueError("route points must reference a valid edge fraction")

    rows = ", ".join(
        f"({point.pid}::bigint, {point.edge_id}::bigint, "
        f"{point.fraction:.17g}::float8, 'b'::char)"
        for point in (start, end)
    )
    return (
        f"SELECT * FROM (VALUES {rows}) "
        "AS route_points(pid, edge_id, fraction, side)"
    )


def edges_sql_for(
    profile: str,
    bounds: tuple[float, float, float, float] | None = None,
) -> str:
    """The pgRouting edges-query for a profile: which roads are usable and
    at what cost. profile is constrained to a Literal at the API layer
    (schemas.py-style allowlist), so spec['exclude']/['cost'] are always one
    of the fixed PROFILES values below — never free-form user input reaching
    this SQL string.
    """
    spec = PROFILES[profile]
    where_sql = _where_sql(profile)
    if bounds is not None:
        west, south, east, north = bounds
        where_sql += (
            " AND geom && ST_MakeEnvelope("
            f"{west:.9f}, {south:.9f}, {east:.9f}, {north:.9f}, 4326)"
        )
    if spec["directed"]:
        return (
            "SELECT id, source, target, "
            f"CASE WHEN direction = 'oneway_reverse' THEN -1 ELSE {spec['cost']} END AS cost, "
            f"CASE WHEN direction = 'oneway' THEN -1 ELSE {spec['cost']} END AS reverse_cost "
            f"FROM road_network_edges WHERE {where_sql}"
        )
    return (
        f"SELECT id, source, target, {spec['cost']} AS cost "
        f"FROM road_network_edges WHERE {where_sql}"
    )


def _route_bounds(
    from_lng: float, from_lat: float, to_lng: float, to_lat: float, multiplier: float,
) -> tuple[float, float, float, float]:
    span = max(abs(to_lng - from_lng), abs(to_lat - from_lat))
    margin = max(0.02, span * 0.25) * multiplier
    return (
        max(-180.0, min(from_lng, to_lng) - margin),
        max(-90.0, min(from_lat, to_lat) - margin),
        min(180.0, max(from_lng, to_lng) + margin),
        min(90.0, max(from_lat, to_lat) + margin),
    )


async def find_route(
    db: AsyncSession, from_lng: float, from_lat: float, to_lng: float, to_lat: float, profile: str,
) -> Optional[dict[str, Any]]:
    await db.execute(text(
        f"SET LOCAL statement_timeout = {ROUTE_STATEMENT_TIMEOUT_MS}"
    ))
    spec = PROFILES[profile]

    start = await _nearest_edge_point(db, from_lng, from_lat, profile, pid=1)
    end = await _nearest_edge_point(db, to_lng, to_lat, profile, pid=2)
    if start is None or end is None:
        return None
    points_sql = points_sql_for(start, end)

    # Most editor routes are local. Feed Dijkstra only an indexed spatial
    # corridor, expand it for detours, and retain one whole-graph fallback for
    # unusually long or constrained routes. Bounds use the projected road
    # points so even a click far inside a building still includes its host
    # edge; the off-network access leg is assembled after pathfinding.
    rows = []
    bounds_attempts = [
        _route_bounds(
            start.snapped_lng, start.snapped_lat,
            end.snapped_lng, end.snapped_lat,
            multiplier,
        )
        for multiplier in (1.0, 2.0, 4.0)
    ] + [None]
    for bounds in bounds_attempts:
        rows = (await db.execute(text(
            "SELECT path_seq, node, edge FROM pgr_withPoints("
            "CAST(:edges_sql AS text), CAST(:points_sql AS text), "
            "CAST(:from_vid AS bigint), CAST(:to_vid AS bigint), CAST('b' AS char), "
            "directed => CAST(:directed AS boolean), details => true) "
            "ORDER BY path_seq"
        ), {
            "edges_sql": edges_sql_for(profile, bounds),
            "points_sql": points_sql,
            "from_vid": start.vid,
            "to_vid": end.vid,
            "directed": spec["directed"],
        })).all()
        if any(row.edge != -1 for row in rows):
            break

    route_steps = route_traversals(rows)
    if not route_steps:
        return None

    # pgr_withPoints finds the correct fractional first/last edge but returns
    # edge ids, not geometry. Reconstruct every traversal in path order and
    # orient/trim it from the current node to the next node. This also handles
    # two requested points lying on the same edge without charging or drawing
    # the unused remainder of that edge.
    segment_rows = (await db.execute(text(
        "WITH route_steps AS ("
        "SELECT * FROM jsonb_to_recordset(CAST(:steps_json AS jsonb)) "
        "AS step(path_seq bigint, node bigint, next_node bigint, edge bigint)"
        "), fractions AS ("
        "SELECT step.path_seq, edge.feature_id, edge.road_type, edge.max_speed, edge.geom, "
        "CASE WHEN step.node = :from_vid THEN :from_fraction "
        "WHEN step.node = :to_vid THEN :to_fraction "
        "WHEN step.node = edge.source THEN 0.0 "
        "WHEN step.node = edge.target THEN 1.0 END AS start_fraction, "
        "CASE WHEN step.next_node = :from_vid THEN :from_fraction "
        "WHEN step.next_node = :to_vid THEN :to_fraction "
        "WHEN step.next_node = edge.source THEN 0.0 "
        "WHEN step.next_node = edge.target THEN 1.0 END AS end_fraction "
        "FROM route_steps step JOIN road_network_edges edge ON edge.id = step.edge"
        "), segments AS ("
        "SELECT path_seq, feature_id, road_type, max_speed, "
        "CASE WHEN start_fraction IS NULL OR end_fraction IS NULL "
        "OR abs(start_fraction - end_fraction) <= 1e-15 THEN NULL "
        "WHEN start_fraction < end_fraction "
        "THEN ST_LineSubstring(geom, start_fraction, end_fraction) "
        "ELSE ST_Reverse(ST_LineSubstring(geom, end_fraction, start_fraction)) END AS geom "
        "FROM fractions"
        ") SELECT segments.path_seq, segments.feature_id, "
        "NULLIF(BTRIM(feature.name), '') AS road_name, "
        "ST_AsGeoJSON(segments.geom) AS geojson, "
        "ST_Length(segments.geom::geography) AS distance_m, "
        f"{CAR_SEGMENT_TRAVEL_TIME_SQL} AS car_duration_s "
        "FROM segments LEFT JOIN features feature ON feature.id = segments.feature_id "
        "WHERE segments.geom IS NOT NULL ORDER BY segments.path_seq"
    ), {
        "steps_json": json.dumps(route_steps),
        "from_vid": start.vid,
        "to_vid": end.vid,
        "from_fraction": start.fraction,
        "to_fraction": end.fraction,
    })).all()

    coordinates: list[list[float]] = [[float(from_lng), float(from_lat)]]
    append_coordinate(coordinates, [start.snapped_lng, start.snapped_lat])
    network_distance_m = 0.0
    car_duration_s = 0.0
    route_segments = []
    for row in segment_rows:
        segment_geometry = json.loads(row.geojson)
        append_linestring(coordinates, segment_geometry)
        network_distance_m += float(row.distance_m)
        car_duration_s += float(row.car_duration_s)
        route_segments.append({
            "feature_id": int(row.feature_id),
            "road_name": row.road_name,
            "coordinates": segment_geometry["coordinates"],
            "distance_m": float(row.distance_m),
        })
    append_coordinate(coordinates, [end.snapped_lng, end.snapped_lat])
    finish_at_coordinate(coordinates, [float(to_lng), float(to_lat)])

    if len(coordinates) < 2:
        return None

    access_distance_m = start.access_m + end.access_m
    distance_m = network_distance_m + access_distance_m

    duration_s = (
        car_duration_s + access_distance_m / ACCESS_LEG_SPEED_MPS
        if profile == "car"
        else distance_m / spec["speed_mps"]
    )

    return {
        "geometry": {"type": "LineString", "coordinates": coordinates},
        "distance_m": distance_m,
        "duration_s": duration_s,
        "steps": route_steps_for(
            route_segments,
            [from_lng, from_lat],
            [to_lng, to_lat],
            start.access_m,
            end.access_m,
        ),
    }
