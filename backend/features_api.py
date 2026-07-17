"""Feature CRUD endpoints (rule B1)."""
import json
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2.functions import ST_AsGeoJSON
from geoalchemy2.shape import from_shape
from shapely.geometry import shape
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from config import FEATURE_QUERY_LIMIT, FULL_BASE_THRESHOLD
from database import get_db
from models import Feature
from schemas import (
    AppMeta,
    FeatureCreate,
    FeatureResponse,
    FeatureUpdate,
    FeatureVersion,
    GeoJSONFeature,
    GeoJSONFeatureCollection,
)
from serializers import feature_response, geojson_query, row_to_geojson

router = APIRouter()


def _bbox_filter(bbox: str):
    """west,south,east,north → a GIST-indexed ST_Intersects predicate (rule B6)."""
    parts = bbox.split(",")
    if len(parts) != 4:
        raise HTTPException(status_code=422, detail="bbox must be 'west,south,east,north'")
    try:
        west, south, east, north = (float(part) for part in parts)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="bbox values must be numbers") from error
    if not (west < east and south < north):
        raise HTTPException(status_code=422, detail="bbox must have west < east and south < north")
    envelope = func.ST_MakeEnvelope(west, south, east, north, 4326)
    return func.ST_Intersects(Feature.geometry, envelope)


def _geometry_or_422(geometry: Dict[str, Any]):
    """Convert GeoJSON to a PostGIS value; invalid input is a client error (rule B3)."""
    try:
        return from_shape(shape(geometry), srid=4326)
    except Exception as error:
        raise HTTPException(status_code=422, detail=f"Invalid GeoJSON geometry: {error}") from error


def _conflict(error: IntegrityError) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail="Feature conflicts with an existing record or violates a database constraint",
    )


@router.get("/features", response_model=GeoJSONFeatureCollection)
async def get_features(
    bbox: Optional[str] = Query(default=None, description="west,south,east,north viewport filter"),
    limit: Optional[int] = Query(default=None, ge=1, le=FEATURE_QUERY_LIMIT),
    db: AsyncSession = Depends(get_db),
):
    # No bbox returns the full collection (small-data overlay mode); a bbox
    # scopes the read to the viewport so a country-scale dataset stays cheap.
    query = geojson_query()
    if bbox is not None:
        query = query.where(_bbox_filter(bbox))
    if limit is not None:
        query = query.limit(limit)
    result = await db.execute(query)
    return GeoJSONFeatureCollection(features=[row_to_geojson(row) for row in result])


@router.get("/features/version", response_model=FeatureVersion)
async def get_features_version(db: AsyncSession = Depends(get_db)):
    """One aggregate row instead of the whole collection (rule B6): any
    create, update, or delete changes the count or the max timestamp."""
    result = await db.execute(select(func.count(Feature.id), func.max(Feature.updated_at)))
    count, updated_at = result.one()
    return FeatureVersion(count=count, updated_at=updated_at)


@router.get("/features/search", response_model=GeoJSONFeatureCollection)
async def search_features(
    q: str = Query(min_length=1, max_length=255),
    limit: int = Query(default=20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """Name search runs in SQL so it scales past the browser's memory (rule B6).
    Shorter names rank first, so an exact street name beats a long compound."""
    query = (
        geojson_query()
        .where(Feature.name.ilike(f"%{q}%"))
        .order_by(func.length(Feature.name))
        .limit(limit)
    )
    result = await db.execute(query)
    return GeoJSONFeatureCollection(features=[row_to_geojson(row) for row in result])


@router.get("/meta", response_model=AppMeta)
async def get_meta(db: AsyncSession = Depends(get_db)):
    """Load-time mode hint: whether the dataset is large enough to render the
    whole map from editor tiles instead of the small-data overlay."""
    count = await db.scalar(select(func.count(Feature.id)))
    return AppMeta(feature_count=count, full_base=count >= FULL_BASE_THRESHOLD)


@router.get("/features/{feature_id}/businesses", response_model=GeoJSONFeatureCollection)
async def get_building_businesses(feature_id: int, db: AsyncSession = Depends(get_db)):
    """All businesses registered in one building (rule B6: one query)."""
    result = await db.execute(geojson_query().where(Feature.building_id == feature_id))
    return GeoJSONFeatureCollection(features=[row_to_geojson(row) for row in result])


@router.get("/features/{feature_id}", response_model=GeoJSONFeature)
async def get_feature(feature_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(geojson_query().where(Feature.id == feature_id))
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Feature not found")
    return row_to_geojson(row)


@router.post("/features", response_model=FeatureResponse)
async def create_feature(feature: FeatureCreate, db: AsyncSession = Depends(get_db)):
    db_feature = Feature(
        geometry=_geometry_or_422(feature.geometry),
        **feature.model_dump(exclude={"geometry"}),
    )
    db.add(db_feature)
    try:
        await db.commit()
    except IntegrityError as error:
        raise _conflict(error) from error
    await db.refresh(db_feature)
    return feature_response(db_feature, feature.geometry)


@router.put("/features/{feature_id}", response_model=FeatureResponse)
async def update_feature(
    feature_id: int,
    feature_update: FeatureUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Feature).where(Feature.id == feature_id))
    db_feature = result.scalar_one_or_none()
    if not db_feature:
        raise HTTPException(status_code=404, detail="Feature not found")

    # Fields absent from the request stay untouched; fields sent as null are
    # cleared. The editor always sends the full payload, so clearing an icon
    # or road attribute round-trips correctly.
    update_data = feature_update.model_dump(exclude_unset=True)
    geometry = update_data.pop("geometry", None)
    if geometry is not None:
        update_data["geometry"] = _geometry_or_422(geometry)
    for attribute, value in update_data.items():
        setattr(db_feature, attribute, value)

    try:
        await db.commit()
    except IntegrityError as error:
        raise _conflict(error) from error
    await db.refresh(db_feature)

    geometry_json = await db.scalar(
        select(ST_AsGeoJSON(Feature.geometry)).where(Feature.id == feature_id)
    )
    return feature_response(db_feature, json.loads(geometry_json) if geometry_json else None)


# Defined before /features/{feature_id} so the literal path wins the match.
@router.delete("/features/clear-all")
async def clear_all_features(db: AsyncSession = Depends(get_db)):
    """Delete all features from the database."""
    result = await db.execute(delete(Feature))
    await db.commit()
    count = result.rowcount or 0
    return {
        "message": f"Successfully cleared {count} features from the database",
        "features_deleted": count,
    }


@router.delete("/features/{feature_id}")
async def delete_feature(feature_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(Feature).where(Feature.id == feature_id))
    if not result.rowcount:
        raise HTTPException(status_code=404, detail="Feature not found")
    await db.commit()
    return {"message": "Feature deleted successfully"}
