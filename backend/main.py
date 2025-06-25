from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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
            properties=feature.properties
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

@app.get("/health")
async def health_check():
    return {"status": "healthy"}