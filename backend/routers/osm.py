"""
OpenStreetMap data loading endpoints
Handles importing buildings, roads, streetlights, and traffic lights from OSM
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from geoalchemy2.shape import from_shape
from shapely.geometry import shape
import httpx
import json
from typing import List

from database import get_db
from models import Feature
from auth import get_current_active_user, require_scope, User

router = APIRouter(prefix="/osm", tags=["openstreetmap"])


@router.post("/polygons")
async def load_osm_polygons(
    bounds: dict,
    polygon_types: List[str] = ["building", "landuse", "natural", "leisure", "amenity"],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scope("features:write"))
):
    """Load polygon data from OpenStreetMap for the given bounds and types"""
    try:
        # Construct Overpass API query for polygons
        type_filters = []
        for polygon_type in polygon_types:
            if polygon_type == "building":
                type_filters.append('way["building"]')
                type_filters.append('relation["building"]["type"="multipolygon"]')
            elif polygon_type == "landuse":
                type_filters.append('way["landuse"]')
                type_filters.append('relation["landuse"]["type"="multipolygon"]')
            elif polygon_type == "natural":
                type_filters.append('way["natural"]')
                type_filters.append('relation["natural"]["type"="multipolygon"]')
            elif polygon_type == "leisure":
                type_filters.append('way["leisure"]')
                type_filters.append('relation["leisure"]["type"="multipolygon"]')
            elif polygon_type == "amenity":
                type_filters.append('way["amenity"]')
                type_filters.append('relation["amenity"]["type"="multipolygon"]')
        
        filters_str = ";\n  ".join(type_filters)
        
        overpass_query = f"""
        [out:json][timeout:25];
        (
          {filters_str};
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
        polygons_loaded = 0
        
        # Process OSM polygons
        for element in osm_data.get('elements', []):
            if element.get('type') in ['way', 'relation']:
                tags = element.get('tags', {})
                
                # Determine polygon category
                polygon_category = None
                for cat in polygon_types:
                    if cat in tags:
                        polygon_category = cat
                        break
                
                if not polygon_category:
                    continue
                
                # Check if we already have this OSM feature
                existing = await db.execute(
                    select(Feature).where(Feature.osm_id == str(element['id']))
                )
                if existing.scalar_one_or_none():
                    continue  # Skip if already exists
                
                # Create geometry from OSM coordinates
                geometry = None
                if element.get('type') == 'way' and 'geometry' in element:
                    coords = [[node['lon'], node['lat']] for node in element['geometry']]
                    if len(coords) >= 3:
                        # Close polygon if not already closed
                        if coords[0] != coords[-1]:
                            coords.append(coords[0])
                        
                        geometry = {
                            "type": "Polygon",
                            "coordinates": [coords]
                        }
                elif element.get('type') == 'relation':
                    # Handle multipolygon relations (simplified)
                    continue  # Skip relations for now
                
                if geometry:
                    # Create feature from OSM data
                    geometry_shape = shape(geometry)
                    geometry_wkt = from_shape(geometry_shape, srid=4326)
                    
                    # Generate appropriate name and description
                    feature_name = tags.get('name', '')
                    if not feature_name:
                        # Generate name based on type
                        if polygon_category == 'building':
                            feature_name = f"{tags.get('building', 'Building')}"
                        elif polygon_category == 'landuse':
                            feature_name = f"{tags.get('landuse', 'Land Use').replace('_', ' ').title()}"
                        elif polygon_category == 'natural':
                            feature_name = f"{tags.get('natural', 'Natural').replace('_', ' ').title()}"
                        elif polygon_category == 'leisure':
                            feature_name = f"{tags.get('leisure', 'Leisure').replace('_', ' ').title()}"
                        elif polygon_category == 'amenity':
                            feature_name = f"{tags.get('amenity', 'Amenity').replace('_', ' ').title()}"
                        else:
                            feature_name = f"{polygon_category.title()}"
                    
                    polygon_feature = Feature(
                        name=feature_name,
                        description=f"{polygon_category.title()} from OSM (ID: {element['id']})",
                        geometry=geometry_wkt,
                        building_number=tags.get('addr:housenumber', '') if polygon_category == 'building' else '',
                        building_type=tags.get('building', '') if polygon_category == 'building' else '',
                        osm_id=str(element['id']),
                        properties={
                            'osm_tags': tags,
                            'source': 'openstreetmap',
                            'polygon_category': polygon_category,
                            'feature_type': polygon_category
                        }
                    )
                    
                    db.add(polygon_feature)
                    polygons_loaded += 1
        
        await db.commit()
        
        return {
            "message": f"Loaded {polygons_loaded} polygon features from OpenStreetMap",
            "polygons_loaded": polygons_loaded
        }
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Error loading OSM polygons: {str(e)}")


@router.post("/buildings")
async def load_osm_buildings(
    bounds: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scope("features:write"))
):
    """Load building data from OpenStreetMap (legacy endpoint)"""
    return await load_osm_polygons(bounds, ["building"], db, current_user)


@router.post("/roads")
async def load_osm_roads(
    bounds: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scope("features:write"))
):
    """Load road data from OpenStreetMap for the given bounds"""
    try:
        # Construct Overpass API query for roads (highways)
        overpass_query = f"""
        [out:json][timeout:25];
        (
          way["highway"]({bounds['south']},{bounds['west']},{bounds['north']},{bounds['east']});
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
        roads_loaded = 0
        
        # Process OSM roads
        for element in osm_data.get('elements', []):
            if element.get('type') == 'way' and 'highway' in element.get('tags', {}):
                # Create geometry from OSM coordinates
                if 'geometry' in element:
                    coords = [[node['lon'], node['lat']] for node in element['geometry']]
                    
                    geometry = {
                        "type": "LineString",
                        "coordinates": coords
                    }
                    
                    tags = element.get('tags', {})
                    
                    # Check if we already have this OSM road
                    existing = await db.execute(
                        select(Feature).where(Feature.osm_id == str(element['id']))
                    )
                    if existing.scalar_one_or_none():
                        continue  # Skip if already exists
                    
                    # Create feature from OSM road data
                    geometry_shape = shape(geometry)
                    geometry_wkt = from_shape(geometry_shape, srid=4326)
                    
                    road_name = tags.get('name', f"{tags.get('highway', 'Road').replace('_', ' ').title()}")
                    
                    road_feature = Feature(
                        name=road_name,
                        description=f"Road from OSM (ID: {element['id']})",
                        geometry=geometry_wkt,
                        road_type=tags.get('highway', ''),
                        direction=tags.get('oneway', ''),
                        lane_count=int(tags.get('lanes', 0)) if tags.get('lanes', '').isdigit() else None,
                        max_speed=int(tags.get('maxspeed', 0)) if tags.get('maxspeed', '').isdigit() else None,
                        surface=tags.get('surface', ''),
                        osm_id=str(element['id']),
                        properties={
                            'osm_tags': tags,
                            'source': 'openstreetmap',
                            'feature_type': 'road'
                        }
                    )
                    
                    db.add(road_feature)
                    roads_loaded += 1
        
        await db.commit()
        
        return {
            "message": f"Loaded {roads_loaded} roads from OpenStreetMap",
            "roads_loaded": roads_loaded
        }
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Error loading OSM roads: {str(e)}")


@router.post("/streetlights")
async def load_osm_streetlights(
    bounds: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scope("features:write"))
):
    """Load streetlight data from OpenStreetMap for the given bounds"""
    try:
        # Construct Overpass API query for streetlights
        overpass_query = f"""
        [out:json][timeout:25];
        (
          node["highway"="street_lamp"]({bounds['south']},{bounds['west']},{bounds['north']},{bounds['east']});
          node["amenity"="street_lamp"]({bounds['south']},{bounds['west']},{bounds['north']},{bounds['east']});
          node["lighting"="yes"]({bounds['south']},{bounds['west']},{bounds['north']},{bounds['east']});
        );
        out;
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
        streetlights_loaded = 0
        
        # Process OSM streetlights
        for element in osm_data.get('elements', []):
            if element.get('type') == 'node' and 'lat' in element and 'lon' in element:
                tags = element.get('tags', {})
                
                # Check if this is actually a streetlight
                is_streetlight = (
                    tags.get('highway') == 'street_lamp' or
                    tags.get('amenity') == 'street_lamp' or
                    tags.get('lighting') == 'yes'
                )
                
                if not is_streetlight:
                    continue
                
                # Check if we already have this OSM streetlight
                existing = await db.execute(
                    select(Feature).where(Feature.osm_id == str(element['id']))
                )
                if existing.scalar_one_or_none():
                    continue  # Skip if already exists
                
                # Create point geometry from OSM coordinates
                geometry = {
                    "type": "Point",
                    "coordinates": [element['lon'], element['lat']]
                }
                
                # Create feature from OSM streetlight data
                geometry_shape = shape(geometry)
                geometry_wkt = from_shape(geometry_shape, srid=4326)
                
                streetlight_feature = Feature(
                    name="Street Light",
                    description=f"Street light from OSM (ID: {element['id']})",
                    geometry=geometry_wkt,
                    icon='💡',
                    osm_id=str(element['id']),
                    properties={
                        'osm_tags': tags,
                        'source': 'openstreetmap',
                        'feature_type': 'streetlight',
                        'lamp_type': tags.get('lamp_type', ''),
                        'support': tags.get('support', ''),
                        'height': tags.get('height', ''),
                        'operator': tags.get('operator', '')
                    }
                )
                
                db.add(streetlight_feature)
                streetlights_loaded += 1
        
        await db.commit()
        
        return {
            "message": f"Loaded {streetlights_loaded} streetlights from OpenStreetMap",
            "streetlights_loaded": streetlights_loaded
        }
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Error loading OSM streetlights: {str(e)}")


@router.post("/traffic-lights")
async def load_osm_traffic_lights(
    bounds: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scope("features:write"))
):
    """Load traffic light data from OpenStreetMap for the given bounds"""
    try:
        # Construct Overpass API query for traffic lights
        overpass_query = f"""
        [out:json][timeout:25];
        (
          node["highway"="traffic_signals"]({bounds['south']},{bounds['west']},{bounds['north']},{bounds['east']});
          node["traffic_signals"="signal"]({bounds['south']},{bounds['west']},{bounds['north']},{bounds['east']});
          node["amenity"="traffic_light"]({bounds['south']},{bounds['west']},{bounds['north']},{bounds['east']});
        );
        out;
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
        traffic_lights_loaded = 0
        
        # Process OSM traffic lights
        for element in osm_data.get('elements', []):
            if element.get('type') == 'node' and 'lat' in element and 'lon' in element:
                tags = element.get('tags', {})
                
                # Check if this is actually a traffic light
                is_traffic_light = (
                    tags.get('highway') == 'traffic_signals' or
                    tags.get('traffic_signals') == 'signal' or
                    tags.get('amenity') == 'traffic_light'
                )
                
                if not is_traffic_light:
                    continue
                
                # Check if we already have this OSM traffic light
                existing = await db.execute(
                    select(Feature).where(Feature.osm_id == str(element['id']))
                )
                if existing.scalar_one_or_none():
                    continue  # Skip if already exists
                
                # Create point geometry from OSM coordinates
                geometry = {
                    "type": "Point",
                    "coordinates": [element['lon'], element['lat']]
                }
                
                # Determine traffic light properties
                signal_type = 'traffic_signals'
                if tags.get('traffic_signals:direction'):
                    signal_type = f"traffic_signals ({tags.get('traffic_signals:direction')})"
                
                # Check for pedestrian signals
                has_pedestrian = tags.get('traffic_signals:pedestrian') == 'yes'
                has_sound = tags.get('traffic_signals:sound') == 'yes'
                has_vibration = tags.get('traffic_signals:vibration') == 'yes'
                
                # Get timing information
                cycle_time = None
                if tags.get('cycle_time'):
                    try:
                        cycle_time = int(tags.get('cycle_time'))
                    except ValueError:
                        pass
                
                # Create feature from OSM traffic light data
                geometry_shape = shape(geometry)
                geometry_wkt = from_shape(geometry_shape, srid=4326)
                
                traffic_light_name = "Traffic Light"
                if tags.get('ref'):
                    traffic_light_name = f"Traffic Light {tags.get('ref')}"
                
                traffic_light_feature = Feature(
                    name=traffic_light_name,
                    description=f"Traffic light from OSM (ID: {element['id']})",
                    geometry=geometry_wkt,
                    icon='🚦',
                    osm_id=str(element['id']),
                    properties={
                        'osm_tags': tags,
                        'source': 'openstreetmap',
                        'feature_type': 'traffic_light',
                        'signal_type': signal_type,
                        'has_pedestrian': has_pedestrian,
                        'has_sound': has_sound,
                        'has_vibration': has_vibration,
                        'cycle_time': cycle_time,
                        'direction': tags.get('traffic_signals:direction', ''),
                        'arrow': tags.get('traffic_signals:arrow', ''),
                        'operator': tags.get('operator', ''),
                        'ref': tags.get('ref', '')
                    }
                )
                
                db.add(traffic_light_feature)
                traffic_lights_loaded += 1
        
        await db.commit()
        
        return {
            "message": f"Loaded {traffic_lights_loaded} traffic lights from OpenStreetMap",
            "traffic_lights_loaded": traffic_lights_loaded
        }
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Error loading OSM traffic lights: {str(e)}")