"""On-demand full-country OSM bulk-load endpoints (admin only, rule B1).

The load runs in the background; the admin UI polls /bulk-load/status for a
progress bar. Only one load runs at a time.
"""
import bulk_load
from fastapi import APIRouter, Depends, HTTPException

from auth import require_admin
from models import User
from schemas import BulkLoadRequest

router = APIRouter()


@router.get("/bulk-load/countries")
async def bulk_load_countries(_: User = Depends(require_admin)):
    return [{"key": key, "label": meta["label"]} for key, meta in bulk_load.COUNTRIES.items()]


@router.get("/bulk-load/status")
async def bulk_load_status(_: User = Depends(require_admin)):
    return await bulk_load.status()


@router.post("/bulk-load")
async def bulk_load_start(payload: BulkLoadRequest, _: User = Depends(require_admin)):
    try:
        await bulk_load.start(payload.country)
    except KeyError as error:
        raise HTTPException(status_code=422, detail="Unknown country") from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"status": "started", "country": payload.country}
