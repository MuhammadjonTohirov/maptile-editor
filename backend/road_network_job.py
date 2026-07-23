"""Database-backed ownership and progress state for road-network rebuilds."""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from database import async_session, engine


LOCK_NAME = "maptile_road_network_build"
NOW = object()
_STATE_FIELDS = {
    "status", "phase", "progress", "roads_total", "roads_processed",
    "segments_total", "segments_processed", "vertices_count", "edge_count",
    "started_at", "finished_at", "error", "build_source_revision",
}
_task: asyncio.Task[None] | None = None
_start_lock = asyncio.Lock()


async def _claim_interrupted_state(db: AsyncSession) -> bool:
    # The transaction-scoped claim stays held until the repaired state commits,
    # so a new worker cannot start between the lock check and the UPDATE.
    return bool(await db.scalar(text(
        "SELECT pg_try_advisory_xact_lock(hashtext(:name))"
    ), {"name": LOCK_NAME}))


async def status(db: AsyncSession) -> dict[str, Any]:
    row = (await db.execute(text(
        "SELECT status, phase, progress, roads_total, roads_processed, "
        "segments_total, segments_processed, vertices_count, edge_count, "
        "published_at, started_at, finished_at, updated_at, error, "
        "is_stale, source_revision, published_revision, build_source_revision, "
        "source_changed_at FROM road_network_build_state WHERE id = 1"
    ))).mappings().one()
    result = dict(row)
    if result["status"] == "running" and await _claim_interrupted_state(db):
        result["status"] = "error"
        result["error"] = "Road network rebuild was interrupted by a backend restart."
        await db.execute(text(
            "UPDATE road_network_build_state SET status = 'error', phase = 'error', "
            "finished_at = now(), updated_at = now(), error = :error WHERE id = 1"
        ), {"error": result["error"]})
        await db.commit()
    return result


async def update_state(**fields: Any) -> None:
    if not fields or not set(fields).issubset(_STATE_FIELDS):
        raise ValueError("invalid road network build state update")
    assignments = ", ".join(
        f"{name} = now()" if value is NOW else f"{name} = :{name}"
        for name, value in fields.items()
    )
    parameters = {
        name: value
        for name, value in fields.items()
        if value is not NOW
    }
    async with async_session() as db:
        await db.execute(text(
            f"UPDATE road_network_build_state "
            f"SET {assignments}, updated_at = now() WHERE id = 1"
        ), parameters)
        await db.commit()


async def _run_with_lock(
    run_job: Callable[[], Awaitable[None]],
    lock_connection: AsyncConnection,
) -> None:
    try:
        await run_job()
    finally:
        await lock_connection.execute(text(
            "SELECT pg_advisory_unlock(hashtext(:name))"
        ), {"name": LOCK_NAME})
        await lock_connection.close()


async def start(run_job: Callable[[], Awaitable[None]]) -> None:
    """Start one database-claimed rebuild across all backend processes."""
    global _task
    async with _start_lock:
        lock_connection = await engine.connect()
        acquired = bool(await lock_connection.scalar(text(
            "SELECT pg_try_advisory_lock(hashtext(:name))"
        ), {"name": LOCK_NAME}))
        if not acquired:
            await lock_connection.close()
            raise RuntimeError("a road network rebuild is already running")
        try:
            await update_state(
                status="running", phase="segments", progress=0,
                roads_total=0, roads_processed=0, segments_total=0,
                segments_processed=0, vertices_count=0, edge_count=None,
                started_at=NOW, finished_at=None, error=None,
            )
        except Exception:
            await lock_connection.execute(text(
                "SELECT pg_advisory_unlock(hashtext(:name))"
            ), {"name": LOCK_NAME})
            await lock_connection.close()
            raise
        _task = asyncio.create_task(_run_with_lock(run_job, lock_connection))
