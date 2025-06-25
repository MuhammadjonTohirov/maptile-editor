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
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())