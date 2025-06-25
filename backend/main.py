from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from geoalchemy2.functions import ST_AsGeoJSON
from geoalchemy2.shape import from_shape
from shapely.geometry import shape
import json
import httpx
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

app = FastAPI(title="Map Editor API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "Map Editor API", "version": "1.0.0"}

@app.get("/features", response_model=GeoJSONFeatureCollection)
async def get_features(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(
            Feature.id,
            Feature.name,
            Feature.description,
            Feature.properties,
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
            "description": feature.description
        })
        
        geojson_features.append(GeoJSONFeature(
            id=feature.id,
            geometry=geometry,
            properties=properties
        ))
    
    return GeoJSONFeatureCollection(features=geojson_features)

@app.get("/features/{feature_id}", response_model=GeoJSONFeature)
async def get_feature(feature_id: int, db: AsyncSession = Depends(get_db)):
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

@app.post("/features", response_model=FeatureResponse)
async def create_feature(feature: FeatureCreate, db: AsyncSession = Depends(get_db)):
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
            osm_id=feature.osm_id
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

@app.put("/features/{feature_id}", response_model=FeatureResponse)
async def update_feature(
    feature_id: int, 
    feature_update: FeatureUpdate, 
    db: AsyncSession = Depends(get_db)
):
    try:
        result = await db.execute(select(Feature).where(Feature.id == feature_id))
        db_feature = result.scalar_one_or_none()
        
        if not db_feature:
            raise HTTPException(status_code=404, detail="Feature not found")
        
        update_data = {}
        if feature_update.name is not None:
            update_data["name"] = feature_update.name
        if feature_update.description is not None:
            update_data["description"] = feature_update.description
        if feature_update.properties is not None:
            update_data["properties"] = feature_update.properties
        if feature_update.geometry is not None:
            geometry_shape = shape(feature_update.geometry)
            update_data["geometry"] = from_shape(geometry_shape, srid=4326)
        # Building-specific updates
        if feature_update.building_number is not None:
            update_data["building_number"] = feature_update.building_number
        if feature_update.building_type is not None:
            update_data["building_type"] = feature_update.building_type
        if feature_update.icon is not None:
            update_data["icon"] = feature_update.icon
        if feature_update.osm_id is not None:
            update_data["osm_id"] = feature_update.osm_id
        
        if update_data:
            await db.execute(
                update(Feature).where(Feature.id == feature_id).values(**update_data)
            )
            await db.commit()
            await db.refresh(db_feature)
        
        return FeatureResponse(
            id=db_feature.id,
            name=db_feature.name,
            description=db_feature.description,
            geometry=feature_update.geometry or {},
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
        raise HTTPException(status_code=400, detail=f"Error updating feature: {str(e)}")

@app.delete("/features/{feature_id}")
async def delete_feature(feature_id: int, db: AsyncSession = Depends(get_db)):
    try:
        result = await db.execute(select(Feature).where(Feature.id == feature_id))
        db_feature = result.scalar_one_or_none()
        
        if not db_feature:
            raise HTTPException(status_code=404, detail="Feature not found")
        
        await db.execute(delete(Feature).where(Feature.id == feature_id))
        await db.commit()
        
        return {"message": "Feature deleted successfully"}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Error deleting feature: {str(e)}")

@app.post("/load-osm-buildings")
async def load_osm_buildings(
    bounds: dict,  # {"north": 40.7589, "south": 40.7489, "east": -73.9441, "west": -73.9641}
    db: AsyncSession = Depends(get_db)
):
    """Load building data from OpenStreetMap for the given bounds"""
    try:
        # Construct Overpass API query for buildings
        overpass_query = f"""
        [out:json][timeout:25];
        (
          way["building"]({bounds['south']},{bounds['west']},{bounds['north']},{bounds['east']});
          relation["building"]({bounds['south']},{bounds['west']},{bounds['north']},{bounds['east']});
        );
        out geom;
        """
        
        # Query Overpass API
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://overpass-api.de/api/interpreter",
                data=overpass_query,
                headers={"Content-Type": "text/plain"}
            )
            
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to fetch OSM data")
            
        osm_data = response.json()
        buildings_loaded = 0
        
        # Process OSM buildings
        for element in osm_data.get('elements', []):
            if element.get('type') in ['way', 'relation'] and 'building' in element.get('tags', {}):
                # Create geometry from OSM coordinates
                if element['type'] == 'way' and 'geometry' in element:
                    coords = [[node['lon'], node['lat']] for node in element['geometry']]
                    
                    # Close polygon if not closed
                    if coords[0] != coords[-1]:
                        coords.append(coords[0])
                    
                    geometry = {
                        "type": "Polygon",
                        "coordinates": [coords]
                    }
                    
                    tags = element.get('tags', {})
                    
                    # Check if we already have this OSM building
                    existing = await db.execute(
                        select(Feature).where(Feature.osm_id == str(element['id']))
                    )
                    if existing.scalar_one_or_none():
                        continue  # Skip if already exists
                    
                    # Create feature from OSM data
                    geometry_shape = shape(geometry)
                    geometry_wkt = from_shape(geometry_shape, srid=4326)
                    
                    building_feature = Feature(
                        name=tags.get('name', ''),
                        description=f"Building from OSM (ID: {element['id']})",
                        geometry=geometry_wkt,
                        building_number=tags.get('addr:housenumber', ''),
                        building_type=tags.get('building', 'yes'),
                        osm_id=str(element['id']),
                        properties={
                            'osm_tags': tags,
                            'source': 'openstreetmap'
                        }
                    )
                    
                    db.add(building_feature)
                    buildings_loaded += 1
        
        await db.commit()
        
        return {
            "message": f"Loaded {buildings_loaded} buildings from OpenStreetMap",
            "buildings_loaded": buildings_loaded
        }
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Error loading OSM buildings: {str(e)}")

@app.get("/health")
async def health_check():
    return {"status": "healthy"}