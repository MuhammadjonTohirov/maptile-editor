"""Thin HTTP routes for feature queries and mutation services."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_admin, require_user
from config import FEATURE_QUERY_LIMIT, FULL_BASE_THRESHOLD
from database import get_db
import feature_mutations as mutations
from models import Feature, User
import road_segment_service as road_segments
from schemas import (
    AppMeta,
    FeatureCreate,
    FeatureResponse,
    FeatureUpdate,
    FeatureVersion,
    GeoJSONFeature,
    GeoJSONFeatureCollection,
    RoadSegmentDelete,
    RoadSegmentMutationResponse,
    RoadSegmentRestore,
    RoadSegmentUpdate,
)
from serializers import geojson_query, row_to_geojson


router = APIRouter()

# Kept as a public pure helper for existing ownership tests and callers.
_source_kind_after_user_update = mutations.source_kind_after_user_update


def _mutation_http_error(error: mutations.FeatureMutationError) -> HTTPException:
    if isinstance(error, mutations.FeatureNotFound):
        return HTTPException(status_code=404, detail=str(error))
    if isinstance(error, mutations.PreconditionRequired):
        return HTTPException(status_code=428, detail=str(error))
    if isinstance(error, mutations.InvalidFeature):
        return HTTPException(status_code=422, detail=str(error))
    if isinstance(error, mutations.StaleFeature):
        return HTTPException(status_code=409, detail=str(error))
    if isinstance(error, mutations.PublishedRoadConfirmationRequired):
        return HTTPException(status_code=409, detail=str(error))
    if isinstance(error, mutations.FeatureConflict):
        return HTTPException(status_code=409, detail=str(error))
    return HTTPException(status_code=500, detail="Feature mutation failed")


def _expected_updated_at(
    if_match: Optional[str] = Header(default=None, alias="If-Match"),
) -> datetime:
    try:
        return mutations.parse_version_tag(if_match)
    except mutations.FeatureMutationError as error:
        raise _mutation_http_error(error) from error


def _bbox_filter(bbox: str):
    """west,south,east,north → a GIST-indexed ST_Intersects predicate."""
    parts = bbox.split(",")
    if len(parts) != 4:
        raise HTTPException(status_code=422, detail="bbox must be 'west,south,east,north'")
    try:
        west, south, east, north = (float(part) for part in parts)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="bbox values must be numbers") from error
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise HTTPException(
            status_code=422,
            detail="bbox must use valid coordinates with west < east and south < north",
        )
    envelope = func.ST_MakeEnvelope(west, south, east, north, 4326)
    return func.ST_Intersects(Feature.geometry, envelope)


@router.get("/features", response_model=GeoJSONFeatureCollection)
async def get_features(
    bbox: Optional[str] = Query(default=None, description="west,south,east,north viewport filter"),
    limit: Optional[int] = Query(default=None, ge=1, le=FEATURE_QUERY_LIMIT),
    db: AsyncSession = Depends(get_db),
):
    query = geojson_query()
    if bbox is not None:
        query = query.where(_bbox_filter(bbox))
    query = query.limit(limit or FULL_BASE_THRESHOLD)
    result = await db.execute(query)
    return GeoJSONFeatureCollection(features=[row_to_geojson(row) for row in result])


@router.get("/features/version", response_model=FeatureVersion)
async def get_features_version(db: AsyncSession = Depends(get_db)):
    result = await db.execute(text(
        "SELECT revision, updated_at FROM feature_stat WHERE id"
    ))
    revision, updated_at = result.one()
    return FeatureVersion(revision=revision, updated_at=updated_at)


@router.get("/features/search", response_model=GeoJSONFeatureCollection)
async def search_features(
    q: str = Query(min_length=1, max_length=255),
    limit: int = Query(default=20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
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
    count = await db.scalar(select(func.count(Feature.id)))
    return AppMeta(feature_count=count, full_base=count >= FULL_BASE_THRESHOLD)


@router.get(
    "/features/{feature_id}/businesses",
    response_model=GeoJSONFeatureCollection,
)
async def get_building_businesses(
    feature_id: int,
    db: AsyncSession = Depends(get_db),
):
    parent_type = await db.scalar(
        select(Feature.feature_type).where(Feature.id == feature_id)
    )
    if parent_type is None:
        raise HTTPException(status_code=404, detail="Feature not found")
    if parent_type != "building":
        raise HTTPException(status_code=422, detail="Feature is not a building")
    result = await db.execute(
        geojson_query().where(Feature.building_id == feature_id)
    )
    return GeoJSONFeatureCollection(features=[row_to_geojson(row) for row in result])


@router.get("/features/{feature_id}", response_model=GeoJSONFeature)
async def get_feature(
    feature_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(geojson_query().where(Feature.id == feature_id))
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Feature not found")
    return row_to_geojson(row)


@router.post("/features", response_model=FeatureResponse, status_code=201)
async def create_feature(
    feature: FeatureCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    try:
        return await mutations.create_feature(db, feature, user)
    except mutations.FeatureMutationError as error:
        raise _mutation_http_error(error) from error


@router.put("/features/{feature_id}", response_model=FeatureResponse)
async def update_feature(
    feature_id: int,
    feature_update: FeatureUpdate,
    confirm_published: bool = Query(default=False),
    user: User = Depends(require_user),
    expected_updated_at: datetime = Depends(_expected_updated_at),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await mutations.update_feature(
            db,
            feature_id,
            feature_update,
            user,
            expected_updated_at,
            confirm_published=confirm_published,
        )
    except mutations.FeatureMutationError as error:
        raise _mutation_http_error(error) from error


@router.put(
    "/features/{feature_id}/road-segment",
    response_model=RoadSegmentMutationResponse,
)
async def update_road_segment(
    feature_id: int,
    segment_update: RoadSegmentUpdate,
    user: User = Depends(require_user),
    expected_updated_at: datetime = Depends(_expected_updated_at),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await road_segments.update_road_segment(
            db,
            feature_id,
            segment_update,
            user,
            expected_updated_at,
        )
    except mutations.FeatureMutationError as error:
        raise _mutation_http_error(error) from error


@router.post(
    "/features/{feature_id}/road-segment/delete",
    response_model=RoadSegmentMutationResponse,
)
async def delete_road_segment(
    feature_id: int,
    segment_delete: RoadSegmentDelete,
    confirm_published: bool = Query(default=False),
    user: User = Depends(require_user),
    expected_updated_at: datetime = Depends(_expected_updated_at),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await road_segments.delete_road_segment(
            db,
            feature_id,
            segment_delete,
            user,
            expected_updated_at,
            confirm_published=confirm_published,
        )
    except mutations.FeatureMutationError as error:
        raise _mutation_http_error(error) from error


@router.post(
    "/features/{feature_id}/road-segment/restore",
    response_model=FeatureResponse,
)
async def restore_road_segment(
    feature_id: int,
    restore: RoadSegmentRestore,
    user: User = Depends(require_user),
    expected_updated_at: datetime = Depends(_expected_updated_at),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await road_segments.restore_road_segment(
            db,
            feature_id,
            restore,
            user,
            expected_updated_at,
        )
    except mutations.FeatureMutationError as error:
        raise _mutation_http_error(error) from error


@router.delete("/features/clear-all")
async def clear_all_features(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(delete(Feature))
    await db.commit()
    count = result.rowcount or 0
    return {
        "message": f"Successfully cleared {count} features from the database",
        "features_deleted": count,
    }


@router.delete("/features/{feature_id}")
async def delete_feature(
    feature_id: int,
    confirm_published: bool = Query(default=False),
    _: User = Depends(require_user),
    expected_updated_at: datetime = Depends(_expected_updated_at),
    db: AsyncSession = Depends(get_db),
):
    try:
        await mutations.delete_feature(
            db,
            feature_id,
            expected_updated_at,
            confirm_published=confirm_published,
        )
    except mutations.FeatureMutationError as error:
        raise _mutation_http_error(error) from error
    return {"message": "Feature deleted successfully"}
