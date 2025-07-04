from sqlalchemy import Column, Integer, String, Text, DateTime, func
from sqlalchemy.dialects.postgresql import JSONB
from geoalchemy2 import Geometry
from database import Base

class Feature(Base):
    __tablename__ = "features"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255))
    description = Column(Text)
    geometry = Column(Geometry("GEOMETRY", srid=4326))
    properties = Column(JSONB, default={})
    # Building-specific columns
    building_number = Column(String(50))
    building_type = Column(String(100))
    icon = Column(String(100))
    osm_id = Column(String(50), index=True)  # For referencing OSM data
    # Road-specific columns
    road_type = Column(String(100))  # highway, street, path, etc.
    direction = Column(String(20))   # oneway, bidirectional, etc.
    lane_count = Column(Integer)
    max_speed = Column(Integer)
    surface = Column(String(50))     # asphalt, concrete, gravel, etc.
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())