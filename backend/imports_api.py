"""Bounded OSM import endpoints; the pipeline itself lives in osm_import (rule B7)."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from osm_import import IMPORT_KINDS, run_import
from schemas import BoundsRequest

router = APIRouter()


@router.post("/load-osm-buildings")
async def load_osm_buildings(bounds: BoundsRequest, db: AsyncSession = Depends(get_db)):
    """Load building data from OpenStreetMap for the given bounds."""
    return await run_import(IMPORT_KINDS["buildings"], bounds, db)


@router.post("/load-osm-roads")
async def load_osm_roads(bounds: BoundsRequest, db: AsyncSession = Depends(get_db)):
    """Load road data from OpenStreetMap for the given bounds."""
    return await run_import(IMPORT_KINDS["roads"], bounds, db)


@router.post("/load-osm-streetlights")
async def load_osm_streetlights(bounds: BoundsRequest, db: AsyncSession = Depends(get_db)):
    """Load street light data from OpenStreetMap for the given bounds."""
    return await run_import(IMPORT_KINDS["streetlights"], bounds, db)


@router.post("/load-osm-traffic-lights")
async def load_osm_traffic_lights(bounds: BoundsRequest, db: AsyncSession = Depends(get_db)):
    """Load traffic light data from OpenStreetMap for the given bounds."""
    return await run_import(IMPORT_KINDS["traffic-lights"], bounds, db)
