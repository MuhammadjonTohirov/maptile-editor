from datetime import datetime
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Mirrors the features_source_kind_check DB constraint so bad values fail with
# 422 at the boundary instead of a database error (rule B5).
SourceKind = Literal["manual", "osm_import", "base_tombstone"]
OsmType = Literal["node", "way", "relation"]


class FeatureBase(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = None
    geometry: Dict[str, Any]
    properties: Dict[str, Any] = Field(default_factory=dict)
    # Building-specific properties
    building_number: Optional[str] = Field(default=None, max_length=50)
    building_type: Optional[str] = Field(default=None, max_length=100)
    icon: Optional[str] = Field(default=None, max_length=100)
    osm_id: Optional[str] = Field(default=None, max_length=50)  # Reference to original OSM data
    osm_type: Optional[OsmType] = None
    source_kind: SourceKind = "manual"
    feature_type: Optional[str] = Field(default=None, max_length=64)
    height_m: Optional[float] = Field(default=None, ge=0)
    # Business-specific properties
    business_type: Optional[str] = Field(default=None, max_length=100)
    building_id: Optional[int] = Field(default=None, ge=1)
    # Road-specific properties
    road_type: Optional[str] = Field(default=None, max_length=100)
    direction: Optional[str] = Field(default=None, max_length=20)
    lane_count: Optional[int] = Field(default=None, ge=0)
    max_speed: Optional[int] = Field(default=None, ge=0)
    surface: Optional[str] = Field(default=None, max_length=50)


class FeatureCreate(FeatureBase):
    pass


class FeatureUpdate(BaseModel):
    """Partial update: absent fields stay untouched, explicit nulls clear."""

    name: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = None
    geometry: Optional[Dict[str, Any]] = None
    properties: Optional[Dict[str, Any]] = None
    building_number: Optional[str] = Field(default=None, max_length=50)
    building_type: Optional[str] = Field(default=None, max_length=100)
    icon: Optional[str] = Field(default=None, max_length=100)
    osm_id: Optional[str] = Field(default=None, max_length=50)
    osm_type: Optional[OsmType] = None
    source_kind: Optional[SourceKind] = None
    feature_type: Optional[str] = Field(default=None, max_length=64)
    height_m: Optional[float] = Field(default=None, ge=0)
    business_type: Optional[str] = Field(default=None, max_length=100)
    building_id: Optional[int] = Field(default=None, ge=1)
    road_type: Optional[str] = Field(default=None, max_length=100)
    direction: Optional[str] = Field(default=None, max_length=20)
    lane_count: Optional[int] = Field(default=None, ge=0)
    max_speed: Optional[int] = Field(default=None, ge=0)
    surface: Optional[str] = Field(default=None, max_length=50)


class FeatureResponse(FeatureBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class GeoJSONFeature(BaseModel):
    type: str = "Feature"
    id: int
    geometry: Optional[Dict[str, Any]]
    properties: Dict[str, Any]


class GeoJSONFeatureCollection(BaseModel):
    type: str = "FeatureCollection"
    features: list[GeoJSONFeature]


class FeatureVersion(BaseModel):
    """Cheap change stamp: clients poll this instead of the full collection."""

    count: int
    updated_at: Optional[datetime]


class AppMeta(BaseModel):
    """One-shot mode hint read by the client at load."""

    feature_count: int
    # True once the dataset is large enough to render the whole map from
    # editor tiles instead of the small-data basemap overlay.
    full_base: bool


class BoundsRequest(BaseModel):
    west: float
    south: float
    east: float
    north: float

    @model_validator(mode="after")
    def validate_bounds(self):
        if not (-180 <= self.west < self.east <= 180):
            raise ValueError("bounds must use west < east within longitude limits")
        if not (-90 <= self.south < self.north <= 90):
            raise ValueError("bounds must use south < north within latitude limits")
        # Per-viewport imports are intentionally bounded so they cannot become a
        # substitute for an OSM basemap ingestion pipeline.
        if (self.east - self.west) * (self.north - self.south) > 0.25:
            raise ValueError("requested bounds are too large; zoom in before importing")
        return self

    @property
    def bbox(self) -> str:
        """Overpass bounding-box clause: south,west,north,east."""
        return f"{self.south},{self.west},{self.north},{self.east}"
