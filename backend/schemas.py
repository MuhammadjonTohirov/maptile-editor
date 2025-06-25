from pydantic import BaseModel
from typing import Dict, Any, Optional
from datetime import datetime

class FeatureBase(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    geometry: Dict[str, Any]
    properties: Dict[str, Any] = {}
    # Building-specific properties
    building_number: Optional[str] = None
    building_type: Optional[str] = None
    icon: Optional[str] = None
    osm_id: Optional[str] = None  # Reference to original OSM data

class FeatureCreate(FeatureBase):
    pass

class FeatureUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    geometry: Optional[Dict[str, Any]] = None
    properties: Optional[Dict[str, Any]] = None
    # Building-specific properties
    building_number: Optional[str] = None
    building_type: Optional[str] = None
    icon: Optional[str] = None
    osm_id: Optional[str] = None

class FeatureResponse(FeatureBase):
    id: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

class GeoJSONFeature(BaseModel):
    type: str = "Feature"
    id: int
    geometry: Dict[str, Any]
    properties: Dict[str, Any]

class GeoJSONFeatureCollection(BaseModel):
    type: str = "FeatureCollection"
    features: list[GeoJSONFeature]