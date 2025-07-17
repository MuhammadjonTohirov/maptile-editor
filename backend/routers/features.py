"""
Feature CRUD endpoints
Handles creating, reading, updating, and deleting map features
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from geoalchemy2.functions import ST_AsGeoJSON
from geoalchemy2.shape import from_shape
from shapely.geometry import shape
import json
from typing import List

from database import get_db
from models import Feature
from schemas import (
    FeatureCreate, 
    FeatureUpdate, 
    FeatureResponse, 
    GeoJSONFeature, 
    GeoJSONFeatureCollection
)
from auth import get_current_active_user, require_scope, require_admin, User

router = APIRouter(prefix="/features", tags=["features"])


@router.get("", response_model=GeoJSONFeatureCollection)
async def get_features(
    db: AsyncSession = Depends(get_db)
    # current_user: User = Depends(get_current_active_user)  # Disabled for local dev
):
    """Get all features as GeoJSON"""
    result = await db.execute(
        select(
            Feature.id,
            Feature.name,
            Feature.description,
            Feature.properties,
            Feature.building_number,
            Feature.building_type,
            Feature.icon,
            Feature.osm_id,
            Feature.road_type,
            Feature.direction,
            Feature.lane_count,
            Feature.max_speed,
            Feature.surface,
            ST_AsGeoJSON(Feature.geometry).label("geometry_json")
        )
    )
    features = result.fetchall()
    
    geojson_features = []
    for feature in features:
        geometry = json.loads(feature.geometry_json) if feature.geometry_json else None
        properties = feature.properties or {}
        properties.update({
            "name": feature.name,
            "description": feature.description,
            "building_number": feature.building_number,
            "building_type": feature.building_type,
            "icon": feature.icon,
            "osm_id": feature.osm_id,
            "road_type": feature.road_type,
            "direction": feature.direction,
            "lane_count": feature.lane_count,
            "max_speed": feature.max_speed,
            "surface": feature.surface
        })
        # Remove None values
        properties = {k: v for k, v in properties.items() if v is not None}
        
        geojson_features.append(GeoJSONFeature(
            id=feature.id,
            geometry=geometry,
            properties=properties
        ))
    
    return GeoJSONFeatureCollection(
        type="FeatureCollection",
        features=geojson_features
    )


@router.get("/{feature_id}", response_model=GeoJSONFeature)
async def get_feature(
    feature_id: int, 
    db: AsyncSession = Depends(get_db)
    # current_user: User = Depends(get_current_active_user)  # Disabled for local dev
):
    """Get a specific feature by ID"""
    result = await db.execute(
        select(
            Feature.id,
            Feature.name,
            Feature.description,
            Feature.properties,
            ST_AsGeoJSON(Feature.geometry).label("geometry_json")
        ).where(Feature.id == feature_id)
    )
    feature = result.fetchone()
    
    if not feature:
        raise HTTPException(status_code=404, detail="Feature not found")
    
    geometry = json.loads(feature.geometry_json) if feature.geometry_json else None
    properties = feature.properties or {}
    properties.update({
        "name": feature.name,
        "description": feature.description
    })
    
    return GeoJSONFeature(
        id=feature.id,
        geometry=geometry,
        properties=properties
    )


@router.post("", response_model=FeatureResponse)
async def create_feature(
    feature: FeatureCreate, 
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scope("features:write"))
):
    """Create a new feature"""
    try:
        geometry_shape = shape(feature.geometry)
        geometry_wkt = from_shape(geometry_shape, srid=4326)
        
        db_feature = Feature(
            name=feature.name,
            description=feature.description,
            geometry=geometry_wkt,
            properties=feature.properties,
            building_number=feature.building_number,
            building_type=feature.building_type,
            icon=feature.icon,
            osm_id=feature.osm_id,
            road_type=feature.road_type,
            direction=feature.direction,
            lane_count=feature.lane_count,
            max_speed=feature.max_speed,
            surface=feature.surface
        )
        
        db.add(db_feature)
        await db.commit()
        await db.refresh(db_feature)
        
        return FeatureResponse(
            id=db_feature.id,
            name=db_feature.name,
            description=db_feature.description,
            geometry=feature.geometry,
            properties=db_feature.properties,
            building_number=db_feature.building_number,
            building_type=db_feature.building_type,
            icon=db_feature.icon,
            osm_id=db_feature.osm_id,
            created_at=db_feature.created_at,
            updated_at=db_feature.updated_at
        )
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Error creating feature: {str(e)}")


@router.put("/{feature_id}", response_model=FeatureResponse)
async def update_feature(
    feature_id: int, 
    feature_update: FeatureUpdate, 
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scope("features:write"))
):
    """Update an existing feature"""
    try:
        # Check if feature exists
        result = await db.execute(select(Feature).where(Feature.id == feature_id))
        db_feature = result.scalar_one_or_none()
        
        if not db_feature:
            raise HTTPException(status_code=404, detail="Feature not found")
        
        # Update fields
        update_data = {}
        if feature_update.name is not None:
            update_data['name'] = feature_update.name
        if feature_update.description is not None:
            update_data['description'] = feature_update.description
        if feature_update.properties is not None:
            update_data['properties'] = feature_update.properties
        if feature_update.building_number is not None:
            update_data['building_number'] = feature_update.building_number
        if feature_update.building_type is not None:
            update_data['building_type'] = feature_update.building_type
        if feature_update.icon is not None:
            update_data['icon'] = feature_update.icon
        if feature_update.road_type is not None:
            update_data['road_type'] = feature_update.road_type
        if feature_update.direction is not None:
            update_data['direction'] = feature_update.direction
        if feature_update.lane_count is not None:
            update_data['lane_count'] = feature_update.lane_count
        if feature_update.max_speed is not None:
            update_data['max_speed'] = feature_update.max_speed
        if feature_update.surface is not None:
            update_data['surface'] = feature_update.surface
        
        if feature_update.geometry is not None:
            geometry_shape = shape(feature_update.geometry)
            geometry_wkt = from_shape(geometry_shape, srid=4326)
            update_data['geometry'] = geometry_wkt
        
        # Perform update
        await db.execute(
            update(Feature).where(Feature.id == feature_id).values(**update_data)
        )
        await db.commit()
        
        # Fetch updated feature
        result = await db.execute(select(Feature).where(Feature.id == feature_id))
        updated_feature = result.scalar_one()
        
        return FeatureResponse(
            id=updated_feature.id,
            name=updated_feature.name,
            description=updated_feature.description,
            geometry=feature_update.geometry if feature_update.geometry else None,
            properties=updated_feature.properties,
            building_number=updated_feature.building_number,
            building_type=updated_feature.building_type,
            icon=updated_feature.icon,
            osm_id=updated_feature.osm_id,
            created_at=updated_feature.created_at,
            updated_at=updated_feature.updated_at
        )
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Error updating feature: {str(e)}")


@router.delete("/{feature_id}")
async def delete_feature(
    feature_id: int, 
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scope("features:delete"))
):
    """Delete a specific feature"""
    try:
        result = await db.execute(select(Feature).where(Feature.id == feature_id))
        feature = result.scalar_one_or_none()
        
        if not feature:
            raise HTTPException(status_code=404, detail="Feature not found")
        
        await db.execute(delete(Feature).where(Feature.id == feature_id))
        await db.commit()
        
        return {"message": "Feature deleted successfully"}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Error deleting feature: {str(e)}")


@router.delete("/clear-all")
async def clear_all_features(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Delete all features from the database (admin only)"""
    try:
        result = await db.execute(delete(Feature))
        await db.commit()
        
        return {"message": "All features cleared successfully"}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Error clearing features: {str(e)}")