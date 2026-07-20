"""On-demand full-country OSM bulk load, driven by the backend.

Mirrors scripts/load-uzbekistan-osm.sh but runs `ogr2ogr` and `psql` as
subprocesses inside the backend container (both are on the DB's Docker network),
so no Docker socket is exposed. One job runs at a time; progress is tracked in
memory for the admin's loading screen to poll.
"""
from __future__ import annotations

import asyncio
import os
import shutil
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from sqlalchemy import text

from config import DATABASE_URL
from database import async_session

# Only Uzbekistan for now; the dropdown is populated from this map.
COUNTRIES: dict[str, dict[str, str]] = {
    "uzbekistan": {
        "label": "Uzbekistan",
        "pbf_url": "https://download.geofabrik.de/asia/uzbekistan-latest.osm.pbf",
    },
}

_WORK = Path("/tmp/bulk-load")
_TRANSFORM_SQL = "/scripts/load-uzbekistan-osm.sql"

_pg = urlparse(DATABASE_URL.replace("+asyncpg", ""))
_DB = (_pg.path or "/mapdata").lstrip("/")
PG_PSQL = f"postgresql://{_pg.username}:{_pg.password}@{_pg.hostname}:{_pg.port}/{_DB}"
PG_OGR = f"PG:host={_pg.hostname} port={_pg.port} user={_pg.username} password={_pg.password} dbname={_DB}"

# stage: download → stage → transform → done. progress is 0-100 within a stage.
_job: dict[str, Any] = {"status": "idle", "stage": None, "progress": 0,
                        "message": "", "error": None, "counts": None, "country": None}


def status() -> dict[str, Any]:
    return dict(_job)


def _set(**fields: Any) -> None:
    _job.update(fields)


async def _run(cmd: list[str]) -> None:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    out, _ = await proc.communicate()
    if proc.returncode != 0:
        tail = (out or b"").decode(errors="replace")[-600:]
        raise RuntimeError(f"{cmd[0]} exited {proc.returncode}: {tail}")


async def _psql(*args: str) -> None:
    await _run(["psql", PG_PSQL, "-v", "ON_ERROR_STOP=1", *args])


async def _ogr(pbf: Path, tmp: Path, layer: str, where: str) -> None:
    await _run([
        "ogr2ogr", "--config", "CPL_TMPDIR", str(tmp),
        "--config", "OSM_MAX_TMPFILE_SIZE", "4000",
        "-f", "PostgreSQL", PG_OGR, str(pbf),
        layer, "-nln", layer, "-where", where,
        "-lco", "SCHEMA=osm_load", "-lco", "GEOMETRY_NAME=geom",
        "-lco", "SPATIAL_INDEX=NONE", "-a_srs", "EPSG:4326", "-overwrite",
    ])


async def _download(url: str, dest: Path) -> None:
    async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            total = int(response.headers.get("content-length", 0))
            done = 0
            with open(dest, "wb") as handle:
                async for chunk in response.aiter_bytes(1 << 20):
                    handle.write(chunk)
                    done += len(chunk)
                    if total:
                        _set(progress=min(100, int(done * 100 / total)))


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

        _set(stage="download", progress=0, message=f"Downloading {country['label']} OSM extract…")
        await _download(country["pbf_url"], pbf)

        _set(stage="stage", progress=0, message="Staging buildings…")
        await _psql("-c", "DROP SCHEMA IF EXISTS osm_load CASCADE; CREATE SCHEMA osm_load;")
        await _ogr(pbf, tmp, "multipolygons", "building IS NOT NULL")
        _set(progress=40, message="Staging roads…")
        await _ogr(pbf, tmp, "lines", "highway IS NOT NULL")
        _set(progress=75, message="Staging street furniture…")
        await _ogr(pbf, tmp, "points", "highway IN ('traffic_signals','street_lamp')")

        _set(stage="transform", progress=90, message="Transforming into editable features…")
        await _psql("-f", _TRANSFORM_SQL)
        await _psql("-c", "DROP SCHEMA IF EXISTS osm_load CASCADE;")

        _set(status="done", stage="done", progress=100, message="Bulk load complete.", counts=await _counts())
    except Exception as error:  # noqa: BLE001 — surfaced to the admin UI
        _set(status="error", error=str(error), message="Bulk load failed.")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def start(country_key: str) -> None:
    """Begin a bulk load in the background. Raises if unknown or already running."""
    if country_key not in COUNTRIES:
        raise KeyError(country_key)
    if _job["status"] == "running":
        raise RuntimeError("a bulk load is already running")
    _set(status="running", stage="download", progress=0,
         message="Starting…", error=None, counts=None, country=country_key)
    asyncio.create_task(_run_job(country_key))
