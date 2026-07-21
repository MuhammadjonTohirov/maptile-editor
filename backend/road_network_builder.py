"""Batched pgRouting 4 topology builder.

OSM encodes real road connectivity through shared nodes. Building from those
existing vertices is linear in the number of way segments and, unlike the old
pgr_nodeNetwork wrapper, never performs an all-to-all geometry self-join.

The builder writes disposable shadow tables in committed batches, records
observable progress in road_network_build_state, and swaps the finished graph
into place in one short transaction. The previously published graph remains
available to route queries throughout a later rebuild.
"""
from __future__ import annotations

import asyncio
from contextlib import suppress
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import async_session

ROAD_BATCH_SIZE = 5_000
SEGMENT_BATCH_SIZE = 100_000
# A manual endpoint must be visibly placed on a host road. The frontend uses
# the same eight-metre cap; the build then stores one shared projected point
# and locally splits only that host road. This avoids all-to-all country noding.
MANUAL_JUNCTION_TOLERANCE_M = 8.0
MANUAL_JUNCTION_SEARCH_DEGREES = 0.00015
# PostGIS can return a closest point a few floating-point nanometres off the
# host line. Snap the host to that blade before splitting so the shared point
# becomes an actual graph vertex instead of merely lying on an edge.
MANUAL_JUNCTION_SPLIT_TOLERANCE_DEGREES = 1e-9

_STATE_FIELDS = {
    "status", "phase", "progress", "roads_total", "roads_processed",
    "segments_total", "segments_processed", "vertices_count", "edge_count",
    "started_at", "finished_at", "error", "build_source_revision",
}
_NOW = object()

_task: asyncio.Task[None] | None = None
_start_lock = asyncio.Lock()

_INSERT_MANUAL_JUNCTIONS = text("""
WITH manual_endpoints AS (
    SELECT id AS source_feature_id, 0::smallint AS endpoint_index,
           ST_StartPoint(geometry)::geometry(Point, 4326) AS geom
    FROM features
    WHERE feature_type = 'road' AND source_kind = 'manual'
      AND ST_GeometryType(geometry) = 'ST_LineString'
    UNION ALL
    SELECT id, 1::smallint, ST_EndPoint(geometry)::geometry(Point, 4326)
    FROM features
    WHERE feature_type = 'road' AND source_kind = 'manual'
      AND ST_GeometryType(geometry) = 'ST_LineString'
), nearest AS (
    SELECT endpoint.source_feature_id, endpoint.endpoint_index,
           target.id AS target_feature_id,
           ST_ClosestPoint(target.geometry, endpoint.geom)::geometry(Point, 4326) AS geom,
           ST_Distance(target.geometry::geography, endpoint.geom::geography) AS distance_m
    FROM manual_endpoints endpoint
    CROSS JOIN LATERAL (
        SELECT candidate.id, candidate.geometry
        FROM features candidate
        WHERE candidate.feature_type = 'road'
          AND candidate.source_kind <> 'base_tombstone'
          AND candidate.id <> endpoint.source_feature_id
          AND candidate.geometry && ST_Expand(endpoint.geom, :search_degrees)
        ORDER BY candidate.geometry <-> endpoint.geom
        LIMIT 1
    ) target
)
INSERT INTO road_network_junctions_build
    (source_feature_id, endpoint_index, target_feature_id, geom)
SELECT source_feature_id, endpoint_index, target_feature_id, geom
FROM nearest
WHERE distance_m <= :tolerance_m
""")


def _task_running() -> bool:
    return _task is not None and not _task.done()


async def status(db: AsyncSession) -> dict[str, Any]:
    row = (await db.execute(text(
        "SELECT status, phase, progress, roads_total, roads_processed, "
        "segments_total, segments_processed, vertices_count, edge_count, "
        "published_at, started_at, finished_at, updated_at, error, "
        "is_stale, source_revision, published_revision, build_source_revision, source_changed_at "
        "FROM road_network_build_state WHERE id = 1"
    ))).mappings().one()
    result = dict(row)
    # An in-process task cannot survive a backend restart. Report that state
    # honestly instead of leaving the UI polling a permanently "running" row.
    if result["status"] == "running" and not _task_running():
        result["status"] = "error"
        result["error"] = "Road network rebuild was interrupted by a backend restart."
    return result


async def _update_state(**fields: Any) -> None:
    if not fields or not set(fields).issubset(_STATE_FIELDS):
        raise ValueError("invalid road network build state update")
    assignments = ", ".join(
        f"{name} = now()" if value is _NOW else f"{name} = :{name}"
        for name, value in fields.items()
    )
    parameters = {name: value for name, value in fields.items() if value is not _NOW}
    async with async_session() as db:
        await db.execute(text(
            f"UPDATE road_network_build_state SET {assignments}, updated_at = now() WHERE id = 1"
        ), parameters)
        await db.commit()


async def _prepare_manual_junctions(db: AsyncSession) -> None:
    await db.execute(_INSERT_MANUAL_JUNCTIONS, {
        "search_degrees": MANUAL_JUNCTION_SEARCH_DEGREES,
        "tolerance_m": MANUAL_JUNCTION_TOLERANCE_M,
    })
    await db.execute(text(
        "CREATE INDEX road_network_junctions_build_target_idx "
        "ON road_network_junctions_build (target_feature_id)"
    ))


async def _prepare() -> tuple[int, int]:
    async with async_session() as db:
        version = (await db.execute(text(
            "SELECT extversion FROM pg_extension WHERE extname = 'pgrouting'"
        ))).scalar_one()
        if version != "4.0.1":
            raise RuntimeError(f"pgRouting 4.0.1 is required; database has {version}")

        roads_total = (await db.execute(text(
            "SELECT count(*) FROM features "
            "WHERE feature_type = 'road' AND source_kind <> 'base_tombstone'"
        ))).scalar_one()
        source_revision = (await db.execute(text(
            "SELECT source_revision FROM road_network_build_state WHERE id = 1"
        ))).scalar_one()

        for statement in (
            "DROP TABLE IF EXISTS road_network_segments_build",
            "DROP TABLE IF EXISTS road_network_junctions_build",
            "DROP TABLE IF EXISTS road_network_edges_next",
            "DROP TABLE IF EXISTS road_network_vertices_next",
            "DROP TABLE IF EXISTS road_network_edges_previous",
            "DROP TABLE IF EXISTS road_network_vertices_previous",
            """
            CREATE UNLOGGED TABLE road_network_junctions_build (
                source_feature_id BIGINT NOT NULL,
                endpoint_index SMALLINT NOT NULL,
                target_feature_id BIGINT NOT NULL,
                geom GEOMETRY(Point, 4326) NOT NULL,
                PRIMARY KEY (source_feature_id, endpoint_index)
            )
            """,
            """
            CREATE UNLOGGED TABLE road_network_segments_build (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                feature_id BIGINT NOT NULL,
                road_type TEXT,
                direction TEXT,
                max_speed INTEGER,
                lane_count INTEGER,
                surface TEXT,
                access TEXT,
                service TEXT,
                start_x DOUBLE PRECISION NOT NULL,
                start_y DOUBLE PRECISION NOT NULL,
                end_x DOUBLE PRECISION NOT NULL,
                end_y DOUBLE PRECISION NOT NULL,
                geom GEOMETRY(LineString, 4326) NOT NULL
            )
            """,
            """
            CREATE UNLOGGED TABLE road_network_vertices_next (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                x DOUBLE PRECISION NOT NULL,
                y DOUBLE PRECISION NOT NULL,
                the_geom GEOMETRY(Point, 4326) NOT NULL,
                UNIQUE (x, y)
            )
            """,
            """
            CREATE UNLOGGED TABLE road_network_edges_next (
                id BIGINT NOT NULL,
                feature_id BIGINT NOT NULL,
                road_type TEXT,
                direction TEXT,
                max_speed INTEGER,
                lane_count INTEGER,
                surface TEXT,
                access TEXT,
                service TEXT,
                source BIGINT NOT NULL,
                target BIGINT NOT NULL,
                geom GEOMETRY(LineString, 4326) NOT NULL
            )
            """,
        ):
            await db.execute(text(statement))
        await _prepare_manual_junctions(db)
        await db.commit()
    return roads_total, source_revision


_INSERT_SEGMENT_BATCH = text("""
WITH road_batch AS MATERIALIZED (
    SELECT id, road_type, direction, max_speed, lane_count, surface, source_kind,
           COALESCE(
               NULLIF(properties ->> 'routing_access', ''),
               NULLIF(properties -> 'osm_tags' ->> 'motor_vehicle', ''),
               NULLIF(properties -> 'osm_tags' ->> 'vehicle', ''),
               NULLIF(properties -> 'osm_tags' ->> 'access', '')
           ) AS access,
           NULLIF(properties -> 'osm_tags' ->> 'service', '') AS service,
           ST_Force2D(geometry)::geometry(LineString, 4326) AS geometry
    FROM features
    WHERE feature_type = 'road'
      AND source_kind <> 'base_tombstone'
      AND id > :after_id
    ORDER BY id
    LIMIT :batch_size
), snapped AS (
    SELECT b.id, b.road_type, b.direction, b.max_speed, b.lane_count, b.surface, b.access, b.service,
           CASE WHEN b.source_kind = 'manual' THEN
               ST_SetPoint(
                   ST_SetPoint(b.geometry, 0, COALESCE(start_junction.geom, ST_StartPoint(b.geometry))),
                   ST_NPoints(b.geometry) - 1,
                   COALESCE(end_junction.geom, ST_EndPoint(b.geometry))
               )::geometry(LineString, 4326)
           ELSE b.geometry END AS geometry
    FROM road_batch b
    LEFT JOIN road_network_junctions_build start_junction
      ON start_junction.source_feature_id = b.id AND start_junction.endpoint_index = 0
    LEFT JOIN road_network_junctions_build end_junction
      ON end_junction.source_feature_id = b.id AND end_junction.endpoint_index = 1
), blades AS (
    SELECT target_feature_id, ST_Collect(geom) AS geom
    FROM road_network_junctions_build
    WHERE target_feature_id IN (SELECT id FROM road_batch)
    GROUP BY target_feature_id
), noded AS (
    SELECT b.id, b.road_type, b.direction, b.max_speed, b.lane_count, b.surface, b.access, b.service,
           ST_Force2D(d.geom)::geometry(LineString, 4326) AS geom
    FROM snapped b
    LEFT JOIN blades ON blades.target_feature_id = b.id
    CROSS JOIN LATERAL ST_Dump(
        CASE WHEN blades.geom IS NULL THEN b.geometry
             ELSE ST_CollectionExtract(
                 ST_Split(
                     ST_Snap(b.geometry, blades.geom, :junction_split_tolerance),
                     blades.geom
                 ),
                 2
             )
        END
    ) AS d
), dumped AS (
    SELECT b.id AS feature_id, b.road_type, b.direction, b.max_speed, b.lane_count, b.surface, b.access, b.service,
           ST_Force2D(d.geom)::geometry(LineString, 4326) AS geom
    FROM noded b
    CROSS JOIN LATERAL ST_DumpSegments(b.geom) AS d
), prepared AS (
    SELECT feature_id, road_type, direction, max_speed, lane_count, surface, access, service, geom,
           ST_X(ST_StartPoint(geom)) AS start_x,
           ST_Y(ST_StartPoint(geom)) AS start_y,
           ST_X(ST_EndPoint(geom)) AS end_x,
           ST_Y(ST_EndPoint(geom)) AS end_y
    FROM dumped
), inserted AS (
    INSERT INTO road_network_segments_build
        (feature_id, road_type, direction, max_speed, lane_count, surface, access, service,
         start_x, start_y, end_x, end_y, geom)
    SELECT feature_id, road_type, direction, max_speed, lane_count, surface, access, service,
           start_x, start_y, end_x, end_y, geom
    FROM prepared
    WHERE start_x <> end_x OR start_y <> end_y
    RETURNING 1
)
SELECT COALESCE((SELECT max(id) FROM road_batch), :after_id) AS last_id,
       (SELECT count(*) FROM road_batch) AS batch_roads,
       (SELECT count(*) FROM inserted) AS batch_segments
""")


async def _build_segments(roads_total: int) -> int:
    after_id = 0
    roads_processed = 0
    segments_total = 0
    while True:
        async with async_session() as db:
            row = (await db.execute(_INSERT_SEGMENT_BATCH, {
                "after_id": after_id,
                "batch_size": ROAD_BATCH_SIZE,
                "junction_split_tolerance": MANUAL_JUNCTION_SPLIT_TOLERANCE_DEGREES,
            })).mappings().one()
            await db.commit()
        batch_roads = row["batch_roads"]
        if not batch_roads:
            break
        after_id = row["last_id"]
        roads_processed += batch_roads
        segments_total += row["batch_segments"]
        progress = int(45 * roads_processed / max(roads_total, 1))
        await _update_state(
            phase="segments", progress=progress,
            roads_processed=roads_processed, segments_total=segments_total,
        )
    return segments_total


_INSERT_VERTEX_BATCH = text("""
WITH segment_batch AS MATERIALIZED (
    SELECT id, start_x, start_y, end_x, end_y
    FROM road_network_segments_build
    WHERE id > :after_id
    ORDER BY id
    LIMIT :batch_size
), endpoints AS (
    SELECT start_x AS x, start_y AS y FROM segment_batch
    UNION
    SELECT end_x AS x, end_y AS y FROM segment_batch
), inserted AS (
    INSERT INTO road_network_vertices_next (x, y, the_geom)
    SELECT x, y, ST_SetSRID(ST_MakePoint(x, y), 4326)
    FROM endpoints
    ON CONFLICT (x, y) DO NOTHING
    RETURNING 1
)
SELECT COALESCE((SELECT max(id) FROM segment_batch), :after_id) AS last_id,
       (SELECT count(*) FROM segment_batch) AS batch_segments,
       (SELECT count(*) FROM inserted) AS vertices_added
""")


async def _build_vertices(segments_total: int) -> int:
    after_id = 0
    segments_processed = 0
    vertices_count = 0
    while True:
        async with async_session() as db:
            row = (await db.execute(_INSERT_VERTEX_BATCH, {
                "after_id": after_id,
                "batch_size": SEGMENT_BATCH_SIZE,
            })).mappings().one()
            await db.commit()
        batch_segments = row["batch_segments"]
        if not batch_segments:
            break
        after_id = row["last_id"]
        segments_processed += batch_segments
        vertices_count += row["vertices_added"]
        progress = 45 + int(25 * segments_processed / max(segments_total, 1))
        await _update_state(
            phase="vertices", progress=progress,
            segments_processed=segments_processed, vertices_count=vertices_count,
        )
    return vertices_count


_INSERT_EDGE_BATCH = text("""
WITH segment_batch AS MATERIALIZED (
    SELECT *
    FROM road_network_segments_build
    WHERE id > :after_id
    ORDER BY id
    LIMIT :batch_size
), inserted AS (
    INSERT INTO road_network_edges_next
        (id, feature_id, road_type, direction, max_speed, lane_count, surface, access, service, source, target, geom)
    SELECT s.id, s.feature_id, s.road_type, s.direction, s.max_speed, s.lane_count, s.surface, s.access, s.service,
           source_vertex.id, target_vertex.id, s.geom
    FROM segment_batch s
    JOIN road_network_vertices_next source_vertex
      ON source_vertex.x = s.start_x AND source_vertex.y = s.start_y
    JOIN road_network_vertices_next target_vertex
      ON target_vertex.x = s.end_x AND target_vertex.y = s.end_y
    RETURNING 1
)
SELECT COALESCE((SELECT max(id) FROM segment_batch), :after_id) AS last_id,
       (SELECT count(*) FROM segment_batch) AS batch_segments,
       (SELECT count(*) FROM inserted) AS edges_added
""")


async def _build_edges(segments_total: int) -> int:
    after_id = 0
    segments_processed = 0
    edge_count = 0
    while True:
        async with async_session() as db:
            row = (await db.execute(_INSERT_EDGE_BATCH, {
                "after_id": after_id,
                "batch_size": SEGMENT_BATCH_SIZE,
            })).mappings().one()
            await db.commit()
        batch_segments = row["batch_segments"]
        if not batch_segments:
            break
        if row["edges_added"] != batch_segments:
            raise RuntimeError("not every road segment resolved to source and target vertices")
        after_id = row["last_id"]
        segments_processed += batch_segments
        edge_count += row["edges_added"]
        progress = 70 + int(20 * segments_processed / max(segments_total, 1))
        await _update_state(
            phase="edges", progress=progress,
            segments_processed=segments_processed, edge_count=edge_count,
        )
    return edge_count


async def _build_indexes() -> None:
    statements = (
        (90, "ALTER TABLE road_network_edges_next SET LOGGED"),
        (90, "ALTER TABLE road_network_vertices_next SET LOGGED"),
        (91, "ALTER TABLE road_network_edges_next ADD PRIMARY KEY (id)"),
        (92, "CREATE INDEX road_network_edges_next_feature_idx ON road_network_edges_next (feature_id)"),
        (93, "CREATE INDEX road_network_edges_next_source_idx ON road_network_edges_next (source)"),
        (94, "CREATE INDEX road_network_edges_next_target_idx ON road_network_edges_next (target)"),
        (95, "CREATE INDEX road_network_edges_next_geom_idx ON road_network_edges_next USING GIST (geom)"),
        (96, "CREATE INDEX road_network_vertices_next_geom_idx ON road_network_vertices_next USING GIST (the_geom)"),
        (97, "ANALYZE road_network_edges_next"),
        (98, "ANALYZE road_network_vertices_next"),
    )
    for progress, statement in statements:
        await _update_state(phase="indexing", progress=progress)
        async with async_session() as db:
            await db.execute(text(statement))
            await db.commit()


async def _publish(edge_count: int, vertices_count: int, build_source_revision: int) -> None:
    statements = (
        "ALTER TABLE road_network_edges RENAME TO road_network_edges_previous",
        "ALTER TABLE road_network_vertices RENAME TO road_network_vertices_previous",
        "DROP TABLE road_network_edges_previous",
        "DROP TABLE road_network_vertices_previous",
        "DROP TABLE IF EXISTS road_network_edges_vertices_pgr",
        "ALTER TABLE road_network_edges_next RENAME TO road_network_edges",
        "ALTER TABLE road_network_vertices_next RENAME TO road_network_vertices",
        "ALTER INDEX road_network_edges_next_pkey RENAME TO road_network_edges_pkey",
        "ALTER INDEX road_network_edges_next_feature_idx RENAME TO road_network_edges_feature_idx",
        "ALTER INDEX road_network_edges_next_source_idx RENAME TO road_network_edges_source_idx",
        "ALTER INDEX road_network_edges_next_target_idx RENAME TO road_network_edges_target_idx",
        "ALTER INDEX road_network_edges_next_geom_idx RENAME TO road_network_edges_geom_idx",
        "ALTER INDEX road_network_vertices_next_pkey RENAME TO road_network_vertices_pkey",
        "ALTER INDEX road_network_vertices_next_x_y_key RENAME TO road_network_vertices_x_y_key",
        "ALTER INDEX road_network_vertices_next_geom_idx RENAME TO road_network_vertices_geom_idx",
    )
    await _update_state(phase="publishing", progress=99)
    async with async_session() as db:
        async with db.begin():
            source_revision = (await db.execute(text(
                "SELECT source_revision FROM road_network_build_state WHERE id = 1 FOR UPDATE"
            ))).scalar_one()
            if source_revision != build_source_revision:
                raise RuntimeError(
                    "Roads changed during the rebuild; the previous graph remains published."
                )
            for statement in statements:
                await db.execute(text(statement))
            await db.execute(text("""
                UPDATE road_network_build_state
                SET status = 'done', phase = 'done', progress = 100,
                    edge_count = :edge_count, vertices_count = :vertices_count,
                    is_stale = FALSE, published_revision = :build_source_revision,
                    published_at = now(), finished_at = now(), updated_at = now(),
                    error = NULL
                WHERE id = 1
            """), {
                "edge_count": edge_count,
                "vertices_count": vertices_count,
                "build_source_revision": build_source_revision,
            })


async def _cleanup_stage() -> None:
    async with async_session() as db:
        for table in ("road_network_segments_build", "road_network_junctions_build"):
            await db.execute(text(f"DROP TABLE IF EXISTS {table}"))
        await db.commit()


async def _run_job() -> None:
    try:
        roads_total, build_source_revision = await _prepare()
        await _update_state(
            roads_total=roads_total,
            build_source_revision=build_source_revision,
        )
        segments_total = await _build_segments(roads_total)
        await _update_state(
            phase="vertices", progress=45, segments_total=segments_total,
            segments_processed=0,
        )
        vertices_count = await _build_vertices(segments_total)
        await _update_state(phase="edges", progress=70, segments_processed=0)
        edge_count = await _build_edges(segments_total)
        await _build_indexes()
        await _publish(edge_count, vertices_count, build_source_revision)
        with suppress(Exception):
            await _cleanup_stage()
    except asyncio.CancelledError:
        with suppress(Exception):
            await _update_state(
                status="error", phase="cancelled", finished_at=_NOW,
                error="Road network rebuild was interrupted.",
            )
        raise
    except Exception as error:  # noqa: BLE001 — surfaced to the admin UI
        await _update_state(
            status="error", phase="error", finished_at=_NOW, error=str(error),
        )


async def start() -> None:
    """Begin one rebuild in the background."""
    global _task
    async with _start_lock:
        if _task_running():
            raise RuntimeError("a road network rebuild is already running")
        await _update_state(
            status="running", phase="segments", progress=0,
            roads_total=0, roads_processed=0, segments_total=0,
            segments_processed=0, vertices_count=0, edge_count=None,
            started_at=_NOW, finished_at=None, error=None,
        )
        _task = asyncio.create_task(_run_job())
