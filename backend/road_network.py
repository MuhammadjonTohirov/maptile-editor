"""pgRouting route queries and the application-owned topology build facade.

pgRouting 4 no longer mutates edge tables to create topology. The batched
builder lives in road_network_builder.py; this module keeps profile costing and
route assembly together while exposing the small build API used by the router.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

import road_network_builder

CAR_SPEED_KPH_SQL = """GREATEST(COALESCE(max_speed, CASE road_type
    WHEN 'motorway' THEN 90 WHEN 'motorway_link' THEN 50
    WHEN 'trunk' THEN 80 WHEN 'trunk_link' THEN 45
    WHEN 'primary' THEN 60 WHEN 'primary_link' THEN 40
    WHEN 'secondary' THEN 50 WHEN 'secondary_link' THEN 35
    WHEN 'tertiary' THEN 40 WHEN 'tertiary_link' THEN 30
    WHEN 'residential' THEN 30 WHEN 'unclassified' THEN 30
    WHEN 'living_street' THEN 10 WHEN 'service' THEN 20
    WHEN 'track' THEN 10 ELSE 30 END), 5)"""

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


async def _nearest_vertex(
    db: AsyncSession, lng: float, lat: float, profile: str,
) -> Optional[int]:
    # Snap through the nearest edge allowed for this profile. Looking up the
    # globally nearest vertex can put a car on an adjacent footway and make an
    # otherwise valid route appear disconnected.
    result = await db.execute(text(
        "WITH nearest AS ("
        "SELECT source, target, geom, "
        "ST_SetSRID(ST_MakePoint(:lng, :lat), 4326) AS point "
        "FROM road_network_edges "
        f"WHERE {_where_sql(profile)} "
        "ORDER BY geom <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326) LIMIT 1"
        ") SELECT CASE "
        "WHEN ST_StartPoint(geom) <-> point <= ST_EndPoint(geom) <-> point THEN source "
        "ELSE target END AS id FROM nearest"
    ), {"lng": lng, "lat": lat})
    row = result.first()
    return row.id if row else None


def edges_sql_for(
    profile: str,
    bounds: tuple[float, float, float, float] | None = None,
) -> str:
    """The pgr_dijkstra edges-query for a profile: which roads are usable and
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
    spec = PROFILES[profile]

    from_vertex = await _nearest_vertex(db, from_lng, from_lat, profile)
    to_vertex = await _nearest_vertex(db, to_lng, to_lat, profile)
    if from_vertex is None or to_vertex is None or from_vertex == to_vertex:
        return None

    # Most editor routes are local. Feed Dijkstra only an indexed spatial
    # corridor, expand it for detours, and retain one whole-graph fallback for
    # unusually long or constrained routes.
    rows = []
    bounds_attempts = [
        _route_bounds(from_lng, from_lat, to_lng, to_lat, multiplier)
        for multiplier in (1.0, 2.0, 4.0)
    ] + [None]
    for bounds in bounds_attempts:
        rows = (await db.execute(text(
            "SELECT edge, agg_cost FROM pgr_dijkstra("
            "CAST(:edges_sql AS text), CAST(:from_vertex AS bigint), CAST(:to_vertex AS bigint), "
            "directed => CAST(:directed AS boolean)) "
            "ORDER BY path_seq"
        ), {
            "edges_sql": edges_sql_for(profile, bounds),
            "from_vertex": from_vertex,
            "to_vertex": to_vertex,
            "directed": spec["directed"],
        })).all()
        if any(row.edge != -1 for row in rows):
            break

    edge_ids = [row.edge for row in rows if row.edge != -1]
    if not edge_ids:
        return None

    geometry_row = (await db.execute(text(
        "SELECT ST_AsGeoJSON(ST_LineMerge(ST_Collect(geom))) AS geojson, "
        "SUM(ST_Length(geom::geography)) AS distance_m, "
        f"SUM({CAR_TRAVEL_TIME_SQL}) AS car_duration_s "
        "FROM road_network_edges WHERE id = ANY(:edge_ids)"
    ), {"edge_ids": edge_ids})).one()

    duration_s = (
        geometry_row.car_duration_s
        if profile == "car"
        else geometry_row.distance_m / spec["speed_mps"]
    )

    return {
        "geometry": json.loads(geometry_row.geojson),
        "distance_m": geometry_row.distance_m,
        "duration_s": duration_s,
    }
