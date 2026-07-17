"""The single place Feature rows become API shapes (rule B2)."""
import json
from typing import Any, Dict, Optional

from geoalchemy2.functions import ST_AsGeoJSON
from sqlalchemy import Select, select

from models import Feature
from schemas import FeatureResponse, GeoJSONFeature

# Scalar columns merged into GeoJSON properties for map clients. The columns
# are canonical; the JSONB `properties` blob only carries extras such as
# osm_tags and base_* linkage.
PROPERTY_COLUMNS = (
    "name", "description", "building_number", "building_type", "icon",
    "osm_id", "osm_type", "source_kind", "feature_type", "height_m",
    "road_type", "direction", "lane_count", "max_speed", "surface",
)


def geojson_query() -> Select:
    # Deterministic order keeps repeated reads byte-identical, so clients can
    # compare responses without seeing phantom changes.
    return select(
        Feature.id,
        Feature.properties,
        *(getattr(Feature, column) for column in PROPERTY_COLUMNS),
        ST_AsGeoJSON(Feature.geometry).label("geometry_json"),
    ).order_by(Feature.id)


def row_to_geojson(row) -> GeoJSONFeature:
    properties: Dict[str, Any] = dict(row.properties or {})
    properties.update({column: getattr(row, column) for column in PROPERTY_COLUMNS})
    # Drop nulls to keep the collection payload small.
    properties = {key: value for key, value in properties.items() if value is not None}
    geometry = json.loads(row.geometry_json) if row.geometry_json else None
    return GeoJSONFeature(id=row.id, geometry=geometry, properties=properties)


def feature_response(feature: Feature, geometry: Optional[Dict[str, Any]]) -> FeatureResponse:
    return FeatureResponse(
        id=feature.id,
        geometry=geometry,
        properties=feature.properties or {},
        created_at=feature.created_at,
        updated_at=feature.updated_at,
        **{column: getattr(feature, column) for column in PROPERTY_COLUMNS},
    )
