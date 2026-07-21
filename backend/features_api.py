"""Feature CRUD endpoints (rule B1)."""
import json
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2.functions import ST_AsGeoJSON
from geoalchemy2.shape import from_shape
from shapely.geometry import shape
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_admin, require_user
from config import FEATURE_QUERY_LIMIT, FULL_BASE_THRESHOLD
from database import get_db
from models import Feature, SOURCE_KIND_MANUAL, SOURCE_KIND_OSM_IMPORT, User
from road_catalog import RoadValueError, validate_road_values
from road_geometry import RoadGeometryError, validate_road_geometry
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


def _source_kind_after_user_update(current: str, resulting: Optional[str]) -> Optional[str]:
    """An editor write turns imported source data into a durable local override.

    Viewport OSM refreshes may update untouched imports, but must never replace
    geometry or controlled attributes a user has saved. Manual roads also use
    the builder's endpoint-to-segment junction logic.
    """
    if current == SOURCE_KIND_OSM_IMPORT and resulting == SOURCE_KIND_OSM_IMPORT:
        return SOURCE_KIND_MANUAL
    return resulting


def _validate_road_values_or_422(
    feature_type: Optional[str],
    road_type: Optional[str],
    properties: Optional[Dict[str, Any]],
    *,
    direction: Optional[str] = None,
    lane_count: Optional[int] = None,
    max_speed: Optional[int] = None,
    surface: Optional[str] = None,
    previous_road_type: Optional[str] = None,
    previous_direction: Optional[str] = None,
    previous_max_speed: Optional[int] = None,
    previous_surface: Optional[str] = None,
) -> None:
    try:
        validate_road_values(
            feature_type,
            road_type,
            properties,
            direction=direction,
            lane_count=lane_count,
            max_speed=max_speed,
            surface=surface,
            previous_road_type=previous_road_type,
            previous_direction=previous_direction,
            previous_max_speed=previous_max_speed,
            previous_surface=previous_surface,
        )
    except RoadValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


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


def _geometry_or_422(geometry: Dict[str, Any], feature_type: Optional[str] = None):
    """Convert GeoJSON to a PostGIS value; invalid input is a client error (rule B3)."""
    try:
        validate_road_geometry(feature_type, geometry)
        return from_shape(shape(geometry), srid=4326)
    except RoadGeometryError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
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
    # An unbounded read is still capped so a full-country table can never dump
    # millions of rows: overlay-mode datasets stay under FULL_BASE_THRESHOLD,
    # and full-base mode always passes an explicit (smaller) viewport limit.
    query = query.limit(limit or FULL_BASE_THRESHOLD)
    result = await db.execute(query)
    return GeoJSONFeatureCollection(features=[row_to_geojson(row) for row in result])


@router.get("/features/version", response_model=FeatureVersion)
async def get_features_version(db: AsyncSession = Depends(get_db)):
    """O(1) change stamp (rule B6): read the single feature_stat row instead of
    scanning the whole table. A statement-level trigger (migration 008) bumps its
    revision on any create, update, or delete."""
    result = await db.execute(text("SELECT revision, updated_at FROM feature_stat WHERE id"))
    revision, updated_at = result.one()
    return FeatureVersion(revision=revision, updated_at=updated_at)


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
async def create_feature(
    feature: FeatureCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    _validate_road_values_or_422(
        feature.feature_type, feature.road_type, feature.properties,
        direction=feature.direction, lane_count=feature.lane_count,
        max_speed=feature.max_speed, surface=feature.surface,
    )
    db_feature = Feature(
        geometry=_geometry_or_422(feature.geometry, feature.feature_type),
        created_by=user.id,
        updated_by=user.id,
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
    confirm_published: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    result = await db.execute(select(Feature).where(Feature.id == feature_id))
    db_feature = result.scalar_one_or_none()
    if not db_feature:
        raise HTTPException(status_code=404, detail="Feature not found")

    # Fields absent from the request stay untouched; fields sent as null are
    # cleared. The editor always sends the full payload, so clearing an icon
    # or road attribute round-trips correctly.
    update_data = feature_update.model_dump(exclude_unset=True)
    resulting_source_kind = update_data.get("source_kind", db_feature.source_kind)
    update_data["source_kind"] = _source_kind_after_user_update(
        db_feature.source_kind, resulting_source_kind,
    )
    resulting_feature_type = update_data.get("feature_type", db_feature.feature_type)
    resulting_road_type = update_data.get("road_type", db_feature.road_type)
    resulting_properties = update_data.get("properties", db_feature.properties)
    _validate_road_values_or_422(
        resulting_feature_type,
        resulting_road_type,
        resulting_properties,
        direction=update_data.get("direction", db_feature.direction),
        lane_count=update_data.get("lane_count", db_feature.lane_count),
        max_speed=update_data.get("max_speed", db_feature.max_speed),
        surface=update_data.get("surface", db_feature.surface),
        previous_road_type=db_feature.road_type,
        previous_direction=db_feature.direction,
        previous_max_speed=db_feature.max_speed,
        previous_surface=db_feature.surface,
    )
    geometry = update_data.pop("geometry", None)
    if geometry is not None:
        update_data["geometry"] = _geometry_or_422(geometry, resulting_feature_type)
    if (
        db_feature.feature_type == "road"
        and update_data.get("source_kind") == "base_tombstone"
        and not confirm_published
        and await _road_in_published_graph(db, feature_id)
    ):
        raise HTTPException(status_code=409, detail="published_road_confirmation_required")
    for attribute, value in update_data.items():
        setattr(db_feature, attribute, value)
    db_feature.updated_by = user.id

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
async def clear_all_features(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Delete all features from the database (admin only — it wipes everything)."""
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
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_user),
):
    feature_row = (await db.execute(
        select(Feature.id, Feature.feature_type).where(Feature.id == feature_id)
    )).one_or_none()
    if feature_row is None:
        raise HTTPException(status_code=404, detail="Feature not found")
    feature_type = feature_row.feature_type
    if (
        feature_type == "road"
        and not confirm_published
        and await _road_in_published_graph(db, feature_id)
    ):
        raise HTTPException(status_code=409, detail="published_road_confirmation_required")
    await db.execute(delete(Feature).where(Feature.id == feature_id))
    await db.commit()
    return {"message": "Feature deleted successfully"}


async def _road_in_published_graph(db: AsyncSession, feature_id: int) -> bool:
    return bool(await db.scalar(text(
        "SELECT EXISTS (SELECT 1 FROM road_network_edges WHERE feature_id = :feature_id)"
    ), {"feature_id": feature_id}))
