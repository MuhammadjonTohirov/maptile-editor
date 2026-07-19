"""Bounded OSM import endpoints; the pipeline itself lives in osm_import (rule B7)."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_user
from database import get_db
from models import User
from osm_import import IMPORT_KINDS, link_businesses_to_buildings, run_import
from schemas import BoundsRequest

router = APIRouter()


@router.post("/load-osm-buildings")
async def load_osm_buildings(
    bounds: BoundsRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_user),
):
    """Load building data from OpenStreetMap for the given bounds."""
    return await run_import(IMPORT_KINDS["buildings"], bounds, db)


@router.post("/load-osm-roads")
async def load_osm_roads(
    bounds: BoundsRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_user),
):
    """Load road data from OpenStreetMap for the given bounds."""
    return await run_import(IMPORT_KINDS["roads"], bounds, db)


@router.post("/load-osm-streetlights")
async def load_osm_streetlights(
    bounds: BoundsRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_user),
):
    """Load street light data from OpenStreetMap for the given bounds."""
    return await run_import(IMPORT_KINDS["streetlights"], bounds, db)


@router.post("/load-osm-traffic-lights")
async def load_osm_traffic_lights(
    bounds: BoundsRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_user),
):
    """Load traffic light data from OpenStreetMap for the given bounds."""
    return await run_import(IMPORT_KINDS["traffic-lights"], bounds, db)


@router.post("/load-osm-businesses")
async def load_osm_businesses(
    bounds: BoundsRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_user),
):
    """Load shop/office/amenity business POIs from OSM for the given bounds,
    then link each to the building it falls inside."""
    result = await run_import(IMPORT_KINDS["businesses"], bounds, db)
    result["linked_to_buildings"] = await link_businesses_to_buildings(db)
    return result
