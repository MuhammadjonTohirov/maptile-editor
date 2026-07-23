"""Real FastAPI + PostGIS mutation tests.

The normal unit suite skips this module. scripts/test-backend-integration.sh
creates an isolated migrated database and enables it explicitly.
"""
import asyncio
import os

import httpx
import pytest


pytestmark = pytest.mark.skipif(
    os.getenv("RUN_DB_INTEGRATION") != "1",
    reason="requires the isolated PostGIS integration database",
)


async def _create_user():
    from auth import hash_password
    from database import async_session
    from models import User

    async with async_session() as db:
        user = User(
            username="integration-editor",
            password_hash=hash_password("integration-password"),
            is_admin=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user


def _point_payload(name="Initial point"):
    return {
        "name": name,
        "description": "",
        "geometry": {"type": "Point", "coordinates": [69.20, 41.30]},
        "properties": {},
        "source_kind": "manual",
        "feature_type": "point",
    }


def _road_payload():
    return {
        "name": "Integration road",
        "description": "",
        "geometry": {
            "type": "LineString",
            "coordinates": [
                [69.2000, 41.3000],
                [69.2010, 41.3000],
                [69.2020, 41.3000],
            ],
        },
        "properties": {"routing_access": "yes"},
        "source_kind": "manual",
        "feature_type": "road",
        "road_type": "residential",
        "direction": "bidirectional",
        "lane_count": 2,
        "max_speed": 30,
        "surface": "asphalt",
    }


async def _exercise_feature_concurrency(client):
    created_response = await client.post("/features", json=_point_payload())
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()
    version = created["updated_at"]

    fetched = (await client.get(f"/features/{created['id']}")).json()
    assert fetched["properties"]["updated_at"] == version

    missing_precondition = await client.put(
        f"/features/{created['id']}",
        json={"name": "No version"},
    )
    assert missing_precondition.status_code == 428

    competing_updates = await asyncio.gather(
        client.put(
            f"/features/{created['id']}",
            json={"name": "First editor"},
            headers={"If-Match": f'"{version}"'},
        ),
        client.put(
            f"/features/{created['id']}",
            json={"name": "Second editor"},
            headers={"If-Match": f'"{version}"'},
        ),
    )
    assert sorted(response.status_code for response in competing_updates) == [200, 409]
    current = next(
        response.json()
        for response in competing_updates
        if response.status_code == 200
    )
    conflict = next(
        response
        for response in competing_updates
        if response.status_code == 409
    )
    assert conflict.json()["detail"] == "feature_changed"

    invalid_business = await client.post("/features", json={
        **_point_payload("Invalid business"),
        "feature_type": "business",
        "building_id": created["id"],
    })
    assert invalid_business.status_code == 422

    invalid_geometry = await client.post("/features", json={
        **_point_payload("Invalid building"),
        "feature_type": "building",
    })
    assert invalid_geometry.status_code == 422

    deleted = await client.delete(
        f"/features/{created['id']}",
        headers={"If-Match": f'"{current["updated_at"]}"'},
    )
    assert deleted.status_code == 200, deleted.text


async def _exercise_road_span_transaction(client):
    created_response = await client.post("/features", json=_road_payload())
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()
    full_geometry = created["geometry"]

    update_payload = {
        "start": [69.2000, 41.3000],
        "end": [69.2010, 41.3000],
        "feature": {
            **_road_payload(),
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [69.2000, 41.3000],
                    [69.2010, 41.3001],
                ],
            },
        },
    }
    mutation_response = await client.put(
        f"/features/{created['id']}/road-segment",
        json=update_payload,
        headers={"If-Match": f'"{created["updated_at"]}"'},
    )
    assert mutation_response.status_code == 200, mutation_response.text
    mutation = mutation_response.json()
    assert len(mutation["sibling_ids"]) == 1

    stale_delete = await client.post(
        f"/features/{created['id']}/road-segment/delete",
        json={
            "start": [69.2000, 41.3000],
            "end": [69.2010, 41.3001],
        },
        headers={"If-Match": f'"{created["updated_at"]}"'},
    )
    assert stale_delete.status_code == 409

    restore_response = await client.post(
        f"/features/{created['id']}/road-segment/restore",
        json={
            "feature": {**_road_payload(), "geometry": full_geometry},
            "sibling_ids": mutation["sibling_ids"],
        },
        headers={"If-Match": f'"{mutation["feature"]["updated_at"]}"'},
    )
    assert restore_response.status_code == 200, restore_response.text
    restored = restore_response.json()
    assert restored["geometry"] == full_geometry


async def _exercise_job_ownership():
    import bulk_load
    import road_network_builder
    from database import engine
    from sqlalchemy import text

    bulk_status = await bulk_load.status()
    assert bulk_status["status"] == "idle"

    async with engine.connect() as lock_connection:
        assert await lock_connection.scalar(text(
            "SELECT pg_try_advisory_lock(hashtext('maptile_bulk_load'))"
        ))
        with pytest.raises(RuntimeError, match="already running"):
            await bulk_load.start("uzbekistan")
        await lock_connection.execute(text(
            "SELECT pg_advisory_unlock(hashtext('maptile_bulk_load'))"
        ))

        assert await lock_connection.scalar(text(
            "SELECT pg_try_advisory_lock(hashtext('maptile_road_network_build'))"
        ))
        with pytest.raises(RuntimeError, match="already running"):
            await road_network_builder.start()
        await lock_connection.execute(text(
            "SELECT pg_advisory_unlock(hashtext('maptile_road_network_build'))"
        ))


async def _run_scenarios():
    from auth import create_token
    from config import AUTH_COOKIE_NAME
    from main import app

    user = await _create_user()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://integration.test",
        cookies={AUTH_COOKIE_NAME: create_token(user.id)},
    ) as client:
        health = await client.get("/health")
        assert health.status_code == 200
        assert health.json()["database"] == "ready"
        await _exercise_feature_concurrency(client)
        await _exercise_road_span_transaction(client)
        await _exercise_job_ownership()


def test_feature_mutations_against_postgis():
    asyncio.run(_run_scenarios())
