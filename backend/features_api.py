"""Feature CRUD endpoints (rule B1)."""
import json
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from geoalchemy2.functions import ST_AsGeoJSON
from geoalchemy2.shape import from_shape
from shapely.geometry import shape
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Feature
from schemas import (
    FeatureCreate,
    FeatureResponse,
    FeatureUpdate,
    GeoJSONFeature,
    GeoJSONFeatureCollection,
)
from serializers import feature_response, geojson_query, row_to_geojson

router = APIRouter()


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
async def get_features(db: AsyncSession = Depends(get_db)):
    result = await db.execute(geojson_query())
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
