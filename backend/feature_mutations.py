"""Concurrency-safe feature mutation services.

HTTP routing maps these domain errors to response statuses. Persistence,
validation, row locking, and transaction ownership stay out of the router.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Mapping, Optional

from geoalchemy2.functions import ST_AsGeoJSON
from geoalchemy2.shape import from_shape
from shapely.geometry import shape
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from feature_domain import validate_feature_geometry
from models import Feature, SOURCE_KIND_MANUAL, SOURCE_KIND_OSM_IMPORT, User
from road_catalog import RoadValueError, validate_road_values
from road_geometry import RoadGeometryError, validate_road_geometry
from schemas import FeatureCreate, FeatureUpdate
from serializers import feature_response


class FeatureMutationError(Exception):
    """Base class for expected feature-command failures."""


class FeatureNotFound(FeatureMutationError):
    pass


class InvalidFeature(FeatureMutationError):
    pass


class StaleFeature(FeatureMutationError):
    pass


class PreconditionRequired(FeatureMutationError):
    pass


class PublishedRoadConfirmationRequired(FeatureMutationError):
    pass


class FeatureConflict(FeatureMutationError):
    pass


def parse_version_tag(value: str | None) -> datetime:
    """Parse the quoted updated_at value carried in the If-Match header."""
    if value is None:
        raise PreconditionRequired("feature_version_required")
    token = value.strip()
    if token.startswith("W/"):
        token = token[2:].strip()
    if len(token) >= 2 and token[0] == token[-1] == '"':
        token = token[1:-1]
    try:
        parsed = datetime.fromisoformat(token.replace("Z", "+00:00"))
    except ValueError as error:
        raise InvalidFeature("invalid_feature_version") from error
    if parsed.tzinfo is None:
        raise InvalidFeature("invalid_feature_version")
    return parsed


def source_kind_after_user_update(current: str, resulting: Optional[str]) -> Optional[str]:
    """Promote edited OSM imports to durable editor-owned overrides."""
    if current == SOURCE_KIND_OSM_IMPORT and resulting == SOURCE_KIND_OSM_IMPORT:
        return SOURCE_KIND_MANUAL
    return resulting


def geometry_value(geometry: Mapping[str, Any], feature_type: str | None = None):
    try:
        validate_feature_geometry(feature_type, geometry)
        validate_road_geometry(feature_type, geometry)
        return from_shape(shape(geometry), srid=4326)
    except (RoadGeometryError, ValueError) as error:
        raise InvalidFeature(str(error)) from error
    except Exception as error:
        raise InvalidFeature(f"Invalid GeoJSON geometry: {error}") from error


def validate_road_values_for_feature(
    feature_type: Optional[str],
    road_type: Optional[str],
    properties: Optional[dict[str, Any]],
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
        raise InvalidFeature(str(error)) from error


async def locked_feature(
    db: AsyncSession,
    feature_id: int,
    expected_updated_at: datetime,
) -> tuple[Feature, dict[str, Any]]:
    row = (await db.execute(
        select(Feature, ST_AsGeoJSON(Feature.geometry).label("geometry_json"))
        .where(Feature.id == feature_id)
        .with_for_update()
    )).one_or_none()
    if row is None:
        raise FeatureNotFound("Feature not found")
    feature = row.Feature
    if feature.updated_at != expected_updated_at:
        raise StaleFeature("feature_changed")
    geometry = json.loads(row.geometry_json) if row.geometry_json else None
    if geometry is None:
        raise InvalidFeature("Feature geometry is missing")
    return feature, geometry


async def validate_building_link(
    db: AsyncSession,
    feature_type: str | None,
    building_id: int | None,
) -> None:
    if building_id is None:
        return
    if feature_type != "business":
        raise InvalidFeature("Only business features can link to a building")
    parent_type = await db.scalar(select(Feature.feature_type).where(Feature.id == building_id))
    if parent_type != "building":
        raise InvalidFeature("building_id must reference a building feature")


async def validated_update_data(
    db: AsyncSession,
    db_feature: Feature,
    feature_update: FeatureUpdate,
    stored_geometry: Mapping[str, Any],
) -> dict[str, Any]:
    update_data = feature_update.model_dump(exclude_unset=True)
    resulting_source_kind = update_data.get("source_kind", db_feature.source_kind)
    update_data["source_kind"] = source_kind_after_user_update(
        db_feature.source_kind,
        resulting_source_kind,
    )
    resulting_feature_type = update_data.get("feature_type", db_feature.feature_type)
    resulting_road_type = update_data.get("road_type", db_feature.road_type)
    resulting_properties = update_data.get("properties", db_feature.properties)
    resulting_geometry = update_data.get("geometry", stored_geometry)
    validate_feature_geometry(resulting_feature_type, resulting_geometry)
    validate_road_values_for_feature(
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
    await validate_building_link(
        db,
        resulting_feature_type,
        update_data.get("building_id", db_feature.building_id),
    )
    geometry = update_data.pop("geometry", None)
    if geometry is not None:
        update_data["geometry"] = geometry_value(geometry, resulting_feature_type)
    return update_data


def database_conflict(error: IntegrityError) -> FeatureConflict:
    return FeatureConflict(
        "Feature conflicts with an existing record or violates a database constraint"
    )


async def road_in_published_graph(db: AsyncSession, feature_id: int) -> bool:
    return bool(await db.scalar(text(
        "SELECT EXISTS (SELECT 1 FROM road_network_edges WHERE feature_id = :feature_id)"
    ), {"feature_id": feature_id}))


async def create_feature(
    db: AsyncSession,
    feature: FeatureCreate,
    user: User,
):
    validate_road_values_for_feature(
        feature.feature_type,
        feature.road_type,
        feature.properties,
        direction=feature.direction,
        lane_count=feature.lane_count,
        max_speed=feature.max_speed,
        surface=feature.surface,
    )
    await validate_building_link(db, feature.feature_type, feature.building_id)
    db_feature = Feature(
        geometry=geometry_value(feature.geometry, feature.feature_type),
        created_by=user.id,
        updated_by=user.id,
        **feature.model_dump(exclude={"geometry"}),
    )
    db.add(db_feature)
    try:
        await db.commit()
    except IntegrityError as error:
        raise database_conflict(error) from error
    await db.refresh(db_feature)
    return feature_response(db_feature, feature.geometry)


async def update_feature(
    db: AsyncSession,
    feature_id: int,
    feature_update: FeatureUpdate,
    user: User,
    expected_updated_at: datetime,
    *,
    confirm_published: bool = False,
):
    db_feature, stored_geometry = await locked_feature(db, feature_id, expected_updated_at)
    update_data = await validated_update_data(db, db_feature, feature_update, stored_geometry)
    if (
        db_feature.feature_type == "road"
        and update_data.get("source_kind") == "base_tombstone"
        and not confirm_published
        and await road_in_published_graph(db, feature_id)
    ):
        raise PublishedRoadConfirmationRequired("published_road_confirmation_required")
    for attribute, value in update_data.items():
        setattr(db_feature, attribute, value)
    db_feature.updated_by = user.id
    try:
        await db.commit()
    except IntegrityError as error:
        raise database_conflict(error) from error
    await db.refresh(db_feature)
    geometry_json = await db.scalar(
        select(ST_AsGeoJSON(Feature.geometry)).where(Feature.id == feature_id)
    )
    return feature_response(db_feature, json.loads(geometry_json) if geometry_json else None)


async def delete_feature(
    db: AsyncSession,
    feature_id: int,
    expected_updated_at: datetime,
    *,
    confirm_published: bool = False,
) -> None:
    feature, _ = await locked_feature(db, feature_id, expected_updated_at)
    if (
        feature.feature_type == "road"
        and not confirm_published
        and await road_in_published_graph(db, feature_id)
    ):
        raise PublishedRoadConfirmationRequired("published_road_confirmation_required")
    await db.execute(delete(Feature).where(Feature.id == feature_id))
    await db.commit()
