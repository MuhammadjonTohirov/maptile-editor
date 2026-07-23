"""Durable, single-owner full-country OSM bulk loading."""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from config import DATABASE_URL
from database import async_session, engine


logger = logging.getLogger(__name__)

COUNTRIES: dict[str, dict[str, str]] = {
    "uzbekistan": {
        "label": "Uzbekistan",
        "pbf_url": "https://download.geofabrik.de/asia/uzbekistan-latest.osm.pbf",
    },
}

_WORK = Path("/tmp/bulk-load")
_TRANSFORM_SQL = "/scripts/load-uzbekistan-osm.sql"
_LOCK_NAME = "maptile_bulk_load"
_DOWNLOAD_TIMEOUT = httpx.Timeout(connect=30.0, read=300.0, write=30.0, pool=30.0)
_STATE_FIELDS = {
    "status", "stage", "progress", "message", "error", "counts", "country",
    "started_at", "finished_at",
}
_NOW = object()

_pg = urlparse(DATABASE_URL.replace("+asyncpg", ""))
_DB = (_pg.path or "/mapdata").lstrip("/")
_PGPASSWORD = _pg.password or ""
PG_PSQL = f"postgresql://{_pg.username}@{_pg.hostname}:{_pg.port}/{_DB}"
PG_OGR = (
    f"PG:host={_pg.hostname} port={_pg.port} "
    f"user={_pg.username} dbname={_DB}"
)

_task: asyncio.Task[None] | None = None
_start_lock = asyncio.Lock()


async def _claim_interrupted_state(db) -> bool:
    return bool(await db.scalar(text(
        "SELECT pg_try_advisory_xact_lock(hashtext(:name))"
    ), {"name": _LOCK_NAME}))


async def status() -> dict[str, Any]:
    """Return durable progress and repair a restart-interrupted state."""
    async with async_session() as db:
        row = (await db.execute(text(
            "SELECT status, stage, progress, message, error, counts, country, "
            "started_at, finished_at, updated_at FROM bulk_load_state WHERE id = 1"
        ))).mappings().one()
        result = dict(row)
        if result["status"] == "running" and await _claim_interrupted_state(db):
            result.update(
                status="error",
                error="Bulk load was interrupted by a backend restart.",
                message="Bulk load failed.",
            )
            await db.execute(text(
                "UPDATE bulk_load_state SET status = 'error', "
                "error = :error, message = :message, finished_at = now(), "
                "updated_at = now() WHERE id = 1"
            ), {"error": result["error"], "message": result["message"]})
            await db.commit()
        return result


async def _set(**fields: Any) -> None:
    if not fields or not set(fields).issubset(_STATE_FIELDS):
        raise ValueError("invalid bulk-load state update")
    assignments = ", ".join(
        f"{name} = now()" if value is _NOW else f"{name} = :{name}"
        for name, value in fields.items()
    )
    parameters = {
        name: value
        for name, value in fields.items()
        if value is not _NOW
    }
    async with async_session() as db:
        await db.execute(text(
            f"UPDATE bulk_load_state SET {assignments}, updated_at = now() WHERE id = 1"
        ), parameters)
        await db.commit()


def _database_env() -> dict[str, str]:
    return {**os.environ, "PGPASSWORD": _PGPASSWORD}


async def _run(cmd: list[str], *, env: Optional[dict[str, str]] = None) -> None:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env=env,
    )
    out, _ = await proc.communicate()
    if proc.returncode != 0:
        tail = (out or b"").decode(errors="replace")[-600:]
        raise RuntimeError(f"{cmd[0]} exited {proc.returncode}: {tail}")


async def _psql(*args: str) -> None:
    await _run(
        ["psql", PG_PSQL, "-v", "ON_ERROR_STOP=1", *args],
        env=_database_env(),
    )


async def _ogr(pbf: Path, tmp: Path, layer: str, where: str) -> None:
    await _run([
        "ogr2ogr", "--config", "CPL_TMPDIR", str(tmp),
        "--config", "OSM_MAX_TMPFILE_SIZE", "4000",
        "-f", "PostgreSQL", PG_OGR, str(pbf),
        layer, "-nln", layer, "-where", where,
        "-lco", "SCHEMA=osm_load", "-lco", "GEOMETRY_NAME=geom",
        "-lco", "SPATIAL_INDEX=NONE", "-a_srs", "EPSG:4326", "-overwrite",
    ], env=_database_env())


async def _download(url: str, dest: Path) -> None:
    async with httpx.AsyncClient(
        timeout=_DOWNLOAD_TIMEOUT,
        follow_redirects=True,
    ) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            total = int(response.headers.get("content-length", 0))
            done = 0
            last_progress = -1
            with open(dest, "wb") as handle:
                async for chunk in response.aiter_bytes(1 << 20):
                    handle.write(chunk)
                    done += len(chunk)
                    if total:
                        progress = min(100, int(done * 100 / total))
                        if progress != last_progress:
                            await _set(progress=progress)
                            last_progress = progress


async def _counts() -> dict[str, int]:
    async with async_session() as db:
        rows = (await db.execute(text(
            "SELECT feature_type, count(*) FROM features "
            "WHERE source_kind = 'osm_import' GROUP BY feature_type ORDER BY 2 DESC"
        ))).all()
    return {row[0]: row[1] for row in rows}


async def _run_job(country_key: str) -> None:
    country = COUNTRIES[country_key]
    tmp = _WORK / "osmtmp"
    try:
        _WORK.mkdir(parents=True, exist_ok=True)
        tmp.mkdir(exist_ok=True)
        pbf = _WORK / f"{country_key}.pbf"

        await _set(
            stage="download",
            progress=0,
            message=f"Downloading {country['label']} OSM extract…",
        )
        await _download(country["pbf_url"], pbf)

        await _set(stage="stage", progress=0, message="Staging buildings…")
        await _psql("-c", "DROP SCHEMA IF EXISTS osm_load CASCADE; CREATE SCHEMA osm_load;")
        await _ogr(pbf, tmp, "multipolygons", "building IS NOT NULL")
        await _set(progress=40, message="Staging roads…")
        await _ogr(pbf, tmp, "lines", "highway IS NOT NULL")
        await _set(progress=75, message="Staging street furniture…")
        await _ogr(pbf, tmp, "points", "highway IN ('traffic_signals','street_lamp')")

        await _set(
            stage="transform",
            progress=90,
            message="Transforming into editable features…",
        )
        await _psql("-f", _TRANSFORM_SQL)
        await _psql("-c", "DROP SCHEMA IF EXISTS osm_load CASCADE;")
        await _set(
            status="done",
            stage="done",
            progress=100,
            message="Bulk load complete.",
            counts=await _counts(),
            finished_at=_NOW,
        )
    except asyncio.CancelledError:
        await _set(
            status="error",
            error="Bulk load was interrupted.",
            message="Bulk load failed.",
            finished_at=_NOW,
        )
        raise
    except Exception as error:
        logger.exception("Bulk load failed")
        await _set(
            status="error",
            error=str(error),
            message="Bulk load failed.",
            finished_at=_NOW,
        )
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def _run_with_lock(
    country_key: str,
    lock_connection: AsyncConnection,
) -> None:
    try:
        await _run_job(country_key)
    finally:
        await lock_connection.execute(text(
            "SELECT pg_advisory_unlock(hashtext(:name))"
        ), {"name": _LOCK_NAME})
        await lock_connection.close()


async def start(country_key: str) -> None:
    """Start one database-claimed bulk load across all backend processes."""
    global _task
    if country_key not in COUNTRIES:
        raise KeyError(country_key)
    async with _start_lock:
        lock_connection = await engine.connect()
        acquired = bool(await lock_connection.scalar(text(
            "SELECT pg_try_advisory_lock(hashtext(:name))"
        ), {"name": _LOCK_NAME}))
        if not acquired:
            await lock_connection.close()
            raise RuntimeError("a bulk load is already running")
        try:
            await _set(
                status="running",
                stage="download",
                progress=0,
                message="Starting…",
                error=None,
                counts=None,
                country=country_key,
                started_at=_NOW,
                finished_at=None,
            )
        except Exception:
            await lock_connection.execute(text(
                "SELECT pg_advisory_unlock(hashtext(:name))"
            ), {"name": _LOCK_NAME})
            await lock_connection.close()
            raise
        _task = asyncio.create_task(_run_with_lock(country_key, lock_connection))
