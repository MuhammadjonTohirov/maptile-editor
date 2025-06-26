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
            Feature.building_number,
            Feature.building_type,
            Feature.icon,
            Feature.osm_id,
            Feature.road_type,
            Feature.direction,
            Feature.lane_count,
            Feature.max_speed,
            Feature.surface,
            ST_AsGeoJSON(Feature.geometry).label("geometry_json")
        )
    )
    features = result.fetchall()
    
    geojson_features = []
    for feature in features:
        geometry = json.loads(feature.geometry_json) if feature.geometry_json else None
        properties = feature.properties or {}
        
        # Add all feature properties to the properties object
        properties.update({
            "name": feature.name,
            "description": feature.description,
            "building_number": feature.building_number,
            "building_type": feature.building_type,
            "icon": feature.icon,
            "osm_id": feature.osm_id,
            "road_type": feature.road_type,
            "direction": feature.direction,
            "lane_count": feature.lane_count,
            "max_speed": feature.max_speed,
            "surface": feature.surface
        })
        
        # Remove None values to keep the JSON clean
        properties = {k: v for k, v in properties.items() if v is not None}
        
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
            osm_id=feature.osm_id,
            road_type=feature.road_type,
            direction=feature.direction,
            lane_count=feature.lane_count,
            max_speed=feature.max_speed,
            surface=feature.surface
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
        # Road-specific updates
        if feature_update.road_type is not None:
            update_data["road_type"] = feature_update.road_type
        if feature_update.direction is not None:
            update_data["direction"] = feature_update.direction
        if feature_update.lane_count is not None:
            update_data["lane_count"] = feature_update.lane_count
        if feature_update.max_speed is not None:
            update_data["max_speed"] = feature_update.max_speed
        if feature_update.surface is not None:
            update_data["surface"] = feature_update.surface
        
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

@app.delete("/features/clear-all")
async def clear_all_features(db: AsyncSession = Depends(get_db)):
    """Delete all features from the database"""
    try:
        # Count features before deletion
        count_result = await db.execute(select(Feature))
        feature_count = len(count_result.fetchall())
        
        # Delete all features
        await db.execute(delete(Feature))
        await db.commit()
        
        return {
            "message": f"Successfully cleared {feature_count} features from the database",
            "features_deleted": feature_count
        }
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Error clearing features: {str(e)}")

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
        
        # Try multiple Overpass API servers
        overpass_urls = [
            "https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.openstreetmap.ru/api/interpreter"
        ]
        
        response = None
        last_error = None
        
        for url in overpass_urls:
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(
                        url,
                        data=overpass_query,
                        headers={"Content-Type": "text/plain"}
                    )
                    if response.status_code == 200:
                        break
            except Exception as e:
                last_error = str(e)
                continue
        
        if not response or response.status_code != 200:
            error_msg = f"Failed to fetch OSM data from all servers"
            if last_error:
                error_msg += f". Last error: {last_error}"
            raise HTTPException(status_code=400, detail=error_msg)
            
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

@app.post("/load-osm-roads")
async def load_osm_roads(
    bounds: dict,  # {"north": 40.7589, "south": 40.7489, "east": -73.9441, "west": -73.9641}
    db: AsyncSession = Depends(get_db)
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
                    highway_type = tags.get('highway', 'unknown')
                    
                    # Check if we already have this OSM road
                    existing = await db.execute(
                        select(Feature).where(Feature.osm_id == str(element['id']))
                    )
                    if existing.scalar_one_or_none():
                        continue  # Skip if already exists
                    
                    # Determine direction
                    direction = 'bidirectional'  # default
                    if tags.get('oneway') == 'yes':
                        direction = 'oneway'
                    elif tags.get('oneway') == '-1':
                        direction = 'oneway_reverse'
                    
                    # Extract road properties
                    lane_count = None
                    if tags.get('lanes'):
                        try:
                            lane_count = int(tags.get('lanes'))
                        except ValueError:
                            pass
                    
                    max_speed = None
                    if tags.get('maxspeed'):
                        try:
                            speed_str = tags.get('maxspeed').replace(' mph', '').replace(' km/h', '')
                            max_speed = int(speed_str)
                        except ValueError:
                            pass
                    
                    # Create feature from OSM road data
                    geometry_shape = shape(geometry)
                    geometry_wkt = from_shape(geometry_shape, srid=4326)
                    
                    road_feature = Feature(
                        name=tags.get('name', f'{highway_type.title()} Road'),
                        description=f"Road from OSM (ID: {element['id']})",
                        geometry=geometry_wkt,
                        road_type=highway_type,
                        direction=direction,
                        lane_count=lane_count,
                        max_speed=max_speed,
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

@app.post("/load-osm-streetlights")
async def load_osm_streetlights(
    bounds: dict,  # {"north": 40.7589, "south": 40.7489, "east": -73.9441, "west": -73.9641}
    db: AsyncSession = Depends(get_db)
):
    """Load street light data from OpenStreetMap for the given bounds"""
    try:
        # Construct Overpass API query for street lights
        overpass_query = f"""
        [out:json][timeout:25];
        (
          node["highway"="street_lamp"]({bounds['south']},{bounds['west']},{bounds['north']},{bounds['east']});
          node["amenity"="street_lamp"]({bounds['south']},{bounds['west']},{bounds['north']},{bounds['east']});
          node["man_made"="street_lamp"]({bounds['south']},{bounds['west']},{bounds['north']},{bounds['east']});
          node["lighting"="street_lamp"]({bounds['south']},{bounds['west']},{bounds['north']},{bounds['east']});
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
        streetlights_loaded = 0
        
        # Process OSM street lights
        for element in osm_data.get('elements', []):
            if element.get('type') == 'node' and 'lat' in element and 'lon' in element:
                tags = element.get('tags', {})
                
                # Check if this is actually a street light
                is_streetlight = (
                    tags.get('highway') == 'street_lamp' or
                    tags.get('amenity') == 'street_lamp' or
                    tags.get('man_made') == 'street_lamp' or
                    tags.get('lighting') == 'street_lamp'
                )
                
                if not is_streetlight:
                    continue
                
                # Check if we already have this OSM street light
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
                
                # Determine street light properties
                light_type = 'street_lamp'
                if tags.get('lamp_type'):
                    light_type = tags.get('lamp_type')
                elif tags.get('light_source'):
                    light_type = tags.get('light_source')
                
                height = None
                if tags.get('height'):
                    try:
                        height_str = tags.get('height').replace('m', '').replace(' ', '')
                        height = float(height_str)
                    except ValueError:
                        pass
                
                # Create feature from OSM street light data
                geometry_shape = shape(geometry)
                geometry_wkt = from_shape(geometry_shape, srid=4326)
                
                streetlight_feature = Feature(
                    name=f"Street Light ({light_type})",
                    description=f"Street light from OSM (ID: {element['id']})",
                    geometry=geometry_wkt,
                    icon='💡',
                    osm_id=str(element['id']),
                    properties={
                        'osm_tags': tags,
                        'source': 'openstreetmap',
                        'feature_type': 'streetlight',
                        'light_type': light_type,
                        'height': height,
                        'lamp_mount': tags.get('lamp_mount', ''),
                        'support': tags.get('support', ''),
                        'operator': tags.get('operator', '')
                    }
                )
                
                db.add(streetlight_feature)
                streetlights_loaded += 1
        
        await db.commit()
        
        return {
            "message": f"Loaded {streetlights_loaded} street lights from OpenStreetMap",
            "streetlights_loaded": streetlights_loaded
        }
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Error loading OSM street lights: {str(e)}")

@app.post("/load-osm-traffic-lights")
async def load_osm_traffic_lights(
    bounds: dict,  # {"north": 40.7589, "south": 40.7489, "east": -73.9441, "west": -73.9641}
    db: AsyncSession = Depends(get_db)
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

@app.get("/map-style")
async def get_map_style():
    """Serve the custom MapLibre style JSON"""
    import os
    import json
    
    style_path = "/app/map-style.json"
    
    try:
        with open(style_path, 'r') as f:
            style = json.load(f)
        
        # Update the Martin tile URL to use the correct host
        # This ensures the style works from any client
        style["sources"]["features"]["tiles"] = ["http://localhost:3001/features/{z}/{x}/{y}"]
        
        return style
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Map style not found")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Invalid map style format")

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
