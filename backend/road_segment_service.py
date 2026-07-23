"""Atomic node-to-node road-span mutation services."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from geoalchemy2.functions import ST_AsGeoJSON
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from feature_mutations import (
    FeatureNotFound,
    InvalidFeature,
    PublishedRoadConfirmationRequired,
    database_conflict,
    geometry_value,
    locked_feature,
    road_in_published_graph,
    source_kind_after_user_update,
    validate_road_values_for_feature,
    validated_update_data,
)
from models import Feature, SOURCE_KIND_MANUAL, User
from road_geometry import RoadGeometryError, split_road_span_geometry
from schemas import RoadSegmentDelete, RoadSegmentRestore, RoadSegmentUpdate
from serializers import feature_response


def _road_sibling(source: Feature, geometry: dict[str, Any], user: User) -> Feature:
    properties = dict(source.properties or {})
    properties["split_parent_id"] = source.id
    return Feature(
        name=source.name,
        description=source.description,
        geometry=geometry_value(geometry, "road"),
        properties=properties,
        osm_id=None,
        osm_type=None,
        source_kind=SOURCE_KIND_MANUAL,
        feature_type="road",
        road_type=source.road_type,
        direction=source.direction,
        lane_count=source.lane_count,
        max_speed=source.max_speed,
        surface=source.surface,
        created_by=user.id,
        updated_by=user.id,
    )


def _road_parts(stored_geometry: dict[str, Any], start: list[float], end: list[float]):
    try:
        return split_road_span_geometry(stored_geometry, start, end)
    except RoadGeometryError as error:
        raise InvalidFeature(str(error)) from error


def _require_road(feature: Feature) -> None:
    if feature.feature_type != "road":
        raise InvalidFeature("Only roads support segment editing")


async def _mutation_response(db: AsyncSession, feature: Feature, sibling_ids: list[int]):
    await db.refresh(feature)
    geometry_json = await db.scalar(
        select(ST_AsGeoJSON(Feature.geometry)).where(Feature.id == feature.id)
    )
    return {
        "feature": feature_response(feature, json.loads(geometry_json)),
        "sibling_ids": sibling_ids,
    }


async def update_road_segment(
    db: AsyncSession,
    feature_id: int,
    segment_update: RoadSegmentUpdate,
    user: User,
    expected_updated_at: datetime,
):
    db_feature, stored_geometry = await locked_feature(db, feature_id, expected_updated_at)
    _require_road(db_feature)
    if segment_update.feature.geometry is None:
        raise InvalidFeature("Edited road segment geometry is required")
    parts = _road_parts(stored_geometry, segment_update.start, segment_update.end)
    siblings = [
        _road_sibling(db_feature, geometry, user)
        for geometry in (parts["prefix"], parts["suffix"])
        if geometry is not None
    ]
    db.add_all(siblings)
    update_data = await validated_update_data(
        db,
        db_feature,
        segment_update.feature,
        stored_geometry,
    )
    for attribute, value in update_data.items():
        setattr(db_feature, attribute, value)
    db_feature.updated_by = user.id
    try:
        await db.flush()
        sibling_ids = [sibling.id for sibling in siblings]
        await db.commit()
    except IntegrityError as error:
        raise database_conflict(error) from error
    return await _mutation_response(db, db_feature, sibling_ids)


async def delete_road_segment(
    db: AsyncSession,
    feature_id: int,
    segment_delete: RoadSegmentDelete,
    user: User,
    expected_updated_at: datetime,
    *,
    confirm_published: bool = False,
):
    db_feature, stored_geometry = await locked_feature(db, feature_id, expected_updated_at)
    _require_road(db_feature)
    if not confirm_published and await road_in_published_graph(db, feature_id):
        raise PublishedRoadConfirmationRequired("published_road_confirmation_required")
    parts = _road_parts(stored_geometry, segment_delete.start, segment_delete.end)
    remainders = [
        geometry
        for geometry in (parts["prefix"], parts["suffix"])
        if geometry is not None
    ]
    if not remainders:
        raise InvalidFeature("Full roads use the standard delete operation")
    db_feature.geometry = geometry_value(remainders[0], "road")
    db_feature.source_kind = source_kind_after_user_update(
        db_feature.source_kind,
        db_feature.source_kind,
    )
    db_feature.updated_by = user.id
    siblings = [_road_sibling(db_feature, geometry, user) for geometry in remainders[1:]]
    db.add_all(siblings)
    try:
        await db.flush()
        sibling_ids = [sibling.id for sibling in siblings]
        await db.commit()
    except IntegrityError as error:
        raise database_conflict(error) from error
    return await _mutation_response(db, db_feature, sibling_ids)


async def restore_road_segment(
    db: AsyncSession,
    feature_id: int,
    restore: RoadSegmentRestore,
    user: User,
    expected_updated_at: datetime,
):
    db_feature, _ = await locked_feature(db, feature_id, expected_updated_at)
    _require_road(db_feature)
    if restore.feature.feature_type != "road":
        raise InvalidFeature("Only roads support segment restore")
    validate_road_values_for_feature(
        restore.feature.feature_type,
        restore.feature.road_type,
        restore.feature.properties,
        direction=restore.feature.direction,
        lane_count=restore.feature.lane_count,
        max_speed=restore.feature.max_speed,
        surface=restore.feature.surface,
        previous_road_type=db_feature.road_type,
        previous_direction=db_feature.direction,
        previous_max_speed=db_feature.max_speed,
        previous_surface=db_feature.surface,
    )
    restored_data = restore.feature.model_dump(exclude={"geometry"})
    restored_data["geometry"] = geometry_value(
        restore.feature.geometry,
        restore.feature.feature_type,
    )
    for attribute, value in restored_data.items():
        setattr(db_feature, attribute, value)
    db_feature.updated_by = user.id
    sibling_ids = [sibling_id for sibling_id in restore.sibling_ids if sibling_id != feature_id]
    if sibling_ids:
        await db.execute(delete(Feature).where(
            Feature.id.in_(sibling_ids),
            Feature.feature_type == "road",
            Feature.properties["split_parent_id"].astext == str(feature_id),
        ))
    try:
        await db.commit()
    except IntegrityError as error:
        raise database_conflict(error) from error
    await db.refresh(db_feature)
    geometry_json = await db.scalar(
        select(ST_AsGeoJSON(Feature.geometry)).where(Feature.id == feature_id)
    )
    return feature_response(db_feature, json.loads(geometry_json))
