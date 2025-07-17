"""
Spatial query endpoints
Handles spatial queries and geographic operations
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from geoalchemy2.functions import ST_AsGeoJSON, ST_Intersects, ST_MakeEnvelope
import json

from database import get_db
from models import Feature
from schemas import GeoJSONFeature
from auth import get_current_active_user, User

router = APIRouter(prefix="/spatial", tags=["spatial"])


@router.post("/features")
async def get_features_in_bounds(
    bounds: dict,
    zoom: int = 10,
    limit: int = 1000,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get features within specified geographic bounds"""
    try:
        # Extract bounds
        north = bounds.get('north')
        south = bounds.get('south')
        east = bounds.get('east')
        west = bounds.get('west')
        
        if not all([north, south, east, west]):
            raise HTTPException(status_code=400, detail="Invalid bounds. Required: north, south, east, west")
        
        # Create bounding box geometry
        bbox = ST_MakeEnvelope(west, south, east, north, 4326)
        
        # Query features within bounds
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
            ).where(
                ST_Intersects(Feature.geometry, bbox)
            ).limit(limit)
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
        
        return {
            "type": "FeatureCollection", 
            "features": geojson_features,
            "bounds": bounds,
            "zoom": zoom,
            "count": len(geojson_features)
        }
        
    except Exception as e:
        # Fallback to non-spatial query if spatial functions fail
        print(f"Spatial query failed, falling back: {e}")
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
            ).limit(limit)
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
            properties = {k: v for k, v in properties.items() if v is not None}
            
            geojson_features.append(GeoJSONFeature(
                id=feature.id,
                geometry=geometry,
                properties=properties
            ))
        
        return {
            "type": "FeatureCollection", 
            "features": geojson_features,
            "bounds": bounds,
            "zoom": zoom,
            "count": len(geojson_features),
            "fallback": True
        }