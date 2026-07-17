"""One fetch → parse → upsert pipeline shared by every OSM import kind (rule B7)."""
from dataclasses import dataclass
from typing import Callable, Optional

from geoalchemy2.shape import from_shape
from shapely.geometry import shape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    Feature,
    SOURCE_KIND_BASE_TOMBSTONE,
    SOURCE_KIND_OSM_IMPORT,
)
from overpass import (
    fetch_overpass,
    parse_direction,
    parse_height,
    parse_int,
    parse_max_speed,
)
from schemas import BoundsRequest

# Attributes refreshed on re-import; the application feature id never changes.
# "name" is deliberately absent: it is the user-facing title, so a re-import
# (viewport roads auto-import while editing) must never overwrite one that is
# already set. An empty name is backfilled from OSM below.
_REPLACEABLE_ATTRIBUTES = (
    "description", "geometry", "properties", "building_number",
    "building_type", "icon", "osm_id", "osm_type", "source_kind",
    "feature_type", "height_m", "road_type", "direction", "lane_count",
    "max_speed", "surface",
)


@dataclass(frozen=True)
class ImportKind:
    label: str       # human label used in the response message
    count_key: str   # response key the frontend reads, e.g. roads_loaded
    osm_type: str    # node or way; OSM ids are only unique per type
    query: Callable[[BoundsRequest], str]
    build: Callable[[dict], Optional[Feature]]


def _geometry_value(geometry: dict):
    return from_shape(shape(geometry), srid=4326)


def _build_building(element: dict) -> Optional[Feature]:
    tags = element.get("tags", {})
    if element.get("type") != "way" or "building" not in tags or "geometry" not in element:
        return None
    coords = [[node["lon"], node["lat"]] for node in element["geometry"]]
    if coords and coords[0] != coords[-1]:
        coords.append(coords[0])
    if len(coords) < 4:  # a closed ring needs at least 3 distinct positions
        return None
    return Feature(
        name=tags.get("name", ""),
        description=f"Building from OSM (ID: {element['id']})",
        geometry=_geometry_value({"type": "Polygon", "coordinates": [coords]}),
        building_number=tags.get("addr:housenumber", ""),
        building_type=tags.get("building", "yes"),
        osm_id=str(element["id"]),
        osm_type="way",
        source_kind=SOURCE_KIND_OSM_IMPORT,
        feature_type="building",
        height_m=parse_height(tags.get("height")),
        properties={"osm_tags": tags, "source": "openstreetmap"},
    )


def _build_road(element: dict) -> Optional[Feature]:
    tags = element.get("tags", {})
    if element.get("type") != "way" or "highway" not in tags or "geometry" not in element:
        return None
    coords = [[node["lon"], node["lat"]] for node in element["geometry"]]
    if len(coords) < 2:
        return None
    highway_type = tags.get("highway", "unknown")
    return Feature(
        # A road's name is its street title. Unnamed roads stay unnamed so the
        # map never labels them with a fabricated placeholder.
        name=tags.get("name", ""),
        description=f"Road from OSM (ID: {element['id']})",
        geometry=_geometry_value({"type": "LineString", "coordinates": coords}),
        road_type=highway_type,
        direction=parse_direction(tags),
        lane_count=parse_int(tags.get("lanes")),
        max_speed=parse_max_speed(tags.get("maxspeed")),
        surface=tags.get("surface", ""),
        osm_id=str(element["id"]),
        osm_type="way",
        source_kind=SOURCE_KIND_OSM_IMPORT,
        feature_type="road",
        properties={"osm_tags": tags, "source": "openstreetmap", "feature_type": "road"},
    )


def _build_streetlight(element: dict) -> Optional[Feature]:
    tags = element.get("tags", {})
    if element.get("type") != "node" or "lat" not in element or "lon" not in element:
        return None
    if "street_lamp" not in (
        tags.get("highway"), tags.get("amenity"), tags.get("man_made"), tags.get("lighting"),
    ):
        return None
    light_type = tags.get("lamp_type") or tags.get("light_source") or "street_lamp"
    height = parse_height(tags.get("height"))
    return Feature(
        name=f"Street Light ({light_type})",
        description=f"Street light from OSM (ID: {element['id']})",
        geometry=_geometry_value({"type": "Point", "coordinates": [element["lon"], element["lat"]]}),
        icon="💡",
        osm_id=str(element["id"]),
        osm_type="node",
        source_kind=SOURCE_KIND_OSM_IMPORT,
        feature_type="streetlight",
        height_m=height,
        properties={
            "osm_tags": tags,
            "source": "openstreetmap",
            "feature_type": "streetlight",
            "light_type": light_type,
            "height": height,
            "lamp_mount": tags.get("lamp_mount", ""),
            "support": tags.get("support", ""),
            "operator": tags.get("operator", ""),
        },
    )


def _build_traffic_light(element: dict) -> Optional[Feature]:
    tags = element.get("tags", {})
    if element.get("type") != "node" or "lat" not in element or "lon" not in element:
        return None
    is_traffic_light = (
        tags.get("highway") == "traffic_signals"
        or tags.get("traffic_signals") == "signal"
        or tags.get("amenity") == "traffic_light"
    )
    if not is_traffic_light:
        return None
    signal_type = "traffic_signals"
    if tags.get("traffic_signals:direction"):
        signal_type = f"traffic_signals ({tags.get('traffic_signals:direction')})"
    name = f"Traffic Light {tags['ref']}" if tags.get("ref") else "Traffic Light"
    return Feature(
        name=name,
        description=f"Traffic light from OSM (ID: {element['id']})",
        geometry=_geometry_value({"type": "Point", "coordinates": [element["lon"], element["lat"]]}),
        icon="🚦",
        osm_id=str(element["id"]),
        osm_type="node",
        source_kind=SOURCE_KIND_OSM_IMPORT,
        feature_type="traffic_light",
        properties={
            "osm_tags": tags,
            "source": "openstreetmap",
            "feature_type": "traffic_light",
            "signal_type": signal_type,
            "has_pedestrian": tags.get("traffic_signals:pedestrian") == "yes",
            "has_sound": tags.get("traffic_signals:sound") == "yes",
            "has_vibration": tags.get("traffic_signals:vibration") == "yes",
            "cycle_time": parse_int(tags.get("cycle_time")),
            "direction": tags.get("traffic_signals:direction", ""),
            "arrow": tags.get("traffic_signals:arrow", ""),
            "operator": tags.get("operator", ""),
            "ref": tags.get("ref", ""),
        },
    )


IMPORT_KINDS = {
    "buildings": ImportKind(
        label="buildings",
        count_key="buildings_loaded",
        osm_type="way",
        query=lambda bounds: f'[out:json][timeout:25];(way["building"]({bounds.bbox}););out geom;',
        build=_build_building,
    ),
    "roads": ImportKind(
        label="roads",
        count_key="roads_loaded",
        osm_type="way",
        query=lambda bounds: f'[out:json][timeout:25];(way["highway"]({bounds.bbox}););out geom;',
        build=_build_road,
    ),
    "streetlights": ImportKind(
        label="street lights",
        count_key="streetlights_loaded",
        osm_type="node",
        query=lambda bounds: (
            f'[out:json][timeout:25];('
            f'node["highway"="street_lamp"]({bounds.bbox});'
            f'node["amenity"="street_lamp"]({bounds.bbox});'
            f'node["man_made"="street_lamp"]({bounds.bbox});'
            f'node["lighting"="street_lamp"]({bounds.bbox});'
            f');out geom;'
        ),
        build=_build_streetlight,
    ),
    "traffic-lights": ImportKind(
        label="traffic lights",
        count_key="traffic_lights_loaded",
        osm_type="node",
        query=lambda bounds: (
            f'[out:json][timeout:25];('
            f'node["highway"="traffic_signals"]({bounds.bbox});'
            f'node["traffic_signals"="signal"]({bounds.bbox});'
            f'node["amenity"="traffic_light"]({bounds.bbox});'
            f');out geom;'
        ),
        build=_build_traffic_light,
    ),
}


def _build_candidates(kind: ImportKind, elements: list) -> list:
    candidates = []
    for element in elements:
        try:
            feature = kind.build(element)
        except (KeyError, ValueError, TypeError):
            # One malformed element must not fail the whole import.
            continue
        if feature is not None:
            candidates.append(feature)
    return candidates


async def run_import(kind: ImportKind, bounds: BoundsRequest, db: AsyncSession) -> dict:
    osm_data = await fetch_overpass(kind.query(bounds))
    candidates = _build_candidates(kind, osm_data.get("elements", []))

    # One IN query instead of a SELECT per element (rule B6).
    existing_by_osm_id = {}
    osm_ids = [candidate.osm_id for candidate in candidates]
    if osm_ids:
        result = await db.execute(
            select(Feature).where(Feature.osm_type == kind.osm_type, Feature.osm_id.in_(osm_ids))
        )
        existing_by_osm_id = {feature.osm_id: feature for feature in result.scalars()}

    imported = 0
    for candidate in candidates:
        existing = existing_by_osm_id.get(candidate.osm_id)
        if existing is not None and existing.source_kind == SOURCE_KIND_BASE_TOMBSTONE:
            # Deleted through the editor; re-importing must not resurrect it.
            continue
        if existing is not None:
            for attribute in _REPLACEABLE_ATTRIBUTES:
                setattr(existing, attribute, getattr(candidate, attribute))
            if not existing.name:
                existing.name = candidate.name
        else:
            db.add(candidate)
        imported += 1

    await db.commit()
    return {
        "message": f"Loaded {imported} {kind.label} from OpenStreetMap",
        kind.count_key: imported,
    }
