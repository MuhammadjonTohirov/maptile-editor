from geoalchemy2 import Geometry
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB

from database import Base

SOURCE_KIND_MANUAL = "manual"
SOURCE_KIND_OSM_IMPORT = "osm_import"
# A deleted local copy of a basemap object stays as an invisible tombstone row
# so the read-only basemap original remains masked.
SOURCE_KIND_BASE_TOMBSTONE = "base_tombstone"
SOURCE_KINDS = (SOURCE_KIND_MANUAL, SOURCE_KIND_OSM_IMPORT, SOURCE_KIND_BASE_TOMBSTONE)


class Feature(Base):
    __tablename__ = "features"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255))
    description = Column(Text)
    geometry = Column(Geometry("GEOMETRY", srid=4326))
    properties = Column(JSONB, default=dict)
    # Building-specific columns
    building_number = Column(String(50))
    building_type = Column(String(100))
    icon = Column(String(100))
    osm_id = Column(String(50), index=True)  # For referencing OSM data
    osm_type = Column(String(16), index=True)  # node, way, or relation
    source_kind = Column(String(32), nullable=False, default=SOURCE_KIND_MANUAL, index=True)
    feature_type = Column(String(64), index=True)
    height_m = Column(Float)

    # Business registration: a business is a point feature linked to the
    # building it operates in; several businesses can share one building.
    business_type = Column(String(100))  # shop, restaurant, cafe, ...
    building_id = Column(Integer, ForeignKey("features.id", ondelete="SET NULL"), index=True)
    # Road-specific columns
    road_type = Column(String(100))  # highway, street, path, etc.
    direction = Column(String(20))   # oneway, bidirectional, etc.
    lane_count = Column(Integer)
    max_speed = Column(Integer)
    surface = Column(String(50))     # asphalt, concrete, gravel, etc.
    # Audit: who created / last edited the row (ON DELETE SET NULL, see 007).
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class User(Base):
    """An editor account. Reads stay public; every write requires one of these."""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    password_hash = Column(Text, nullable=False)
    is_admin = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
