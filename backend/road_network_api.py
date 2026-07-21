"""Admin-triggered pgRouting network rebuild, and the route query the
editor's "find route" tool calls (rule B1: routes stay thin, logic in
road_network.py).
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

import road_network
from auth import require_admin, require_user
from database import get_db
from models import User

router = APIRouter()


@router.get("/road-network/status")
async def road_network_status(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_user),
):
    return await road_network.status(db)


@router.post("/road-network/rebuild")
async def road_network_rebuild(_: User = Depends(require_admin)):
    try:
        await road_network.start()
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"status": "started"}


@router.get("/route")
async def get_route(
    from_lng: float = Query(..., ge=-180, le=180),
    from_lat: float = Query(..., ge=-90, le=90),
    to_lng: float = Query(..., ge=-180, le=180),
    to_lat: float = Query(..., ge=-90, le=90),
    profile: Literal["car", "bicycle", "foot"] = Query(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_user),
):
    network_state = await road_network.network_state(db)
    if not network_state["ready"]:
        raise HTTPException(status_code=409, detail="Road network has not been built yet")
    route = await road_network.find_route(db, from_lng, from_lat, to_lng, to_lat, profile)
    if route is None:
        raise HTTPException(status_code=404, detail="No route found")
    route["network_stale"] = network_state["is_stale"]
    return route
