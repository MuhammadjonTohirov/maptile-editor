/**
 * Map Configuration Constants
 * Shared between map editor and vector client
 */

const MAP_CONSTANTS = {
    // Zoom level thresholds for feature visibility
    ZOOM_LEVELS: {
        HIDE_ALL: 9,           // Below this: hide all features
        CITY_VIEW: 12,         // Show only major roads
        ROADS_VISIBLE: 14,     // Show road geometries (editor only)
        DISTRICT_VIEW: 13,     // Show roads + large buildings
        STREET_VIEW: 16,       // Show roads + all buildings + traffic lights
        DETAIL_VIEW: 18        // Show everything including streetlights + minor road labels
    },

    // Feature types
    FEATURE_TYPES: {
        ROAD: 'road',
        STREETLIGHT: 'streetlight',
        TRAFFIC_LIGHT: 'traffic_light',
        TURNING_POINT: 'turning_point'
    },

    // Road types considered "major" for city view
    MAJOR_ROAD_TYPES: ['motorway', 'trunk', 'primary'],
    
    // Road types considered "minor" - only visible at max detail
    MINOR_ROAD_TYPES: ['steps', 'path', 'cycleway', 'bridleway', 'pedestrian'],
    
    // Service roads - only visible at high zoom (15-16+)
    SERVICE_ROAD_TYPES: ['service', 'driveway', 'parking_aisle', 'drive-through'],

    // Building criteria for "large building" classification
    LARGE_BUILDING_MIN_LEVELS: 3,

    // Default map settings
    DEFAULT_CENTER: [0, 0],    // Longitude, Latitude
    DEFAULT_ZOOM: 2,

    // Projections
    DISPLAY_PROJECTION: 'EPSG:3857',  // Web Mercator
    DATA_PROJECTION: 'EPSG:4326'      // WGS84
};

// Feature visibility rules based on zoom levels
const FEATURE_VISIBILITY = {
    /**
     * Check if feature should be visible at given zoom level
     * @param {ol.Feature} feature - OpenLayers feature
     * @param {number} zoom - Current zoom level
     * @returns {boolean} - True if feature should be visible
     */
    shouldShowFeature(feature, zoom) {
        const properties = feature.get('properties') || {};
        const featureType = properties.feature_type;
        const roadType = feature.get('road_type') || properties.road_type || properties.osm_tags?.highway;
        const geometryType = feature.getGeometry().getType();
        const isUserCreated = !featureType || !properties.source;
        
        // Hide all features below minimum zoom
        if (zoom < MAP_CONSTANTS.ZOOM_LEVELS.HIDE_ALL) {
            return false;
        }
        
        // Handle user-created features first
        if (isUserCreated) {
            if (geometryType === 'Polygon' && zoom < MAP_CONSTANTS.ZOOM_LEVELS.DISTRICT_VIEW) {
                return false; // Hide user polygons below district view
            }
            return true; // Show other user features at higher zoom levels
        }
        
        // Handle each feature type with specific zoom rules
        switch (featureType) {
            case MAP_CONSTANTS.FEATURE_TYPES.ROAD:
                console.log(`🛣️ Feature type ROAD: ${roadType}, zoom: ${zoom}`);
                return this.shouldShowRoad(roadType, zoom);
                
            case MAP_CONSTANTS.FEATURE_TYPES.STREETLIGHT:
                return zoom >= MAP_CONSTANTS.ZOOM_LEVELS.DETAIL_VIEW;
                
            case MAP_CONSTANTS.FEATURE_TYPES.TRAFFIC_LIGHT:
                return zoom >= MAP_CONSTANTS.ZOOM_LEVELS.STREET_VIEW;
                
            default:
                // Handle roads that don't have feature_type='road' but have road_type and LineString geometry
                if (geometryType === 'LineString' && roadType) {
                    console.log(`🛣️ LineString with roadType: ${roadType}, zoom: ${zoom}`);
                    return this.shouldShowRoad(roadType, zoom);
                }
                
                // Handle polygons (buildings) and other geometry types
                if (geometryType === 'Polygon') {
                    return this.shouldShowPolygon(feature, zoom);
                }
                // Show other feature types from district view onwards
                return zoom >= MAP_CONSTANTS.ZOOM_LEVELS.DISTRICT_VIEW;
        }
    },

    /**
     * Check if road should be visible at given zoom level
     */
    shouldShowRoad(roadType, zoom) {
        // Major roads visible from city view
        if (MAP_CONSTANTS.MAJOR_ROAD_TYPES.includes(roadType)) {
            return true;//zoom >= MAP_CONSTANTS.ZOOM_LEVELS.CITY_VIEW;
        }
        
        // Service roads only visible at high zoom (configurable)
        if (MAP_CONSTANTS.SERVICE_ROAD_TYPES.includes(roadType)) {
            const serviceRoadMinZoom = this.getServiceRoadMinZoom();
            const shouldShow = zoom >= serviceRoadMinZoom;
            return shouldShow;
        }
        
        // Footway roads with configurable visibility
        if (roadType === 'footway') {
            console.log(`🚶 Processing footway road at zoom ${zoom}`);
            const result = this.shouldShowFootway(zoom);
            console.log(`🚶 Footway result: ${result}`);
            return result;
        }
        
        // Minor roads (steps, path, cycleway, etc.) only at max detail
        if (MAP_CONSTANTS.MINOR_ROAD_TYPES.includes(roadType)) {
            return zoom >= MAP_CONSTANTS.ZOOM_LEVELS.DETAIL_VIEW;
        }
        
        // All other roads from roads visible zoom level
        return zoom >= MAP_CONSTANTS.ZOOM_LEVELS.ROADS_VISIBLE;
    },

    /**
     * Check if polygon should be visible at given zoom level
     */
    shouldShowPolygon(feature, zoom) {
        // Large buildings from district view
        if (zoom >= MAP_CONSTANTS.ZOOM_LEVELS.DISTRICT_VIEW) {
            if (zoom < MAP_CONSTANTS.ZOOM_LEVELS.STREET_VIEW) {
                return this.isLargeBuilding(feature);
            }
            return true; // All polygons from street view onwards
        }
        return false;
    },

    /**
     * Check if building is considered "large"
     * @param {ol.Feature} feature - Building feature
     * @returns {boolean} - True if building is large
     */
    isLargeBuilding(feature) {
        const properties = feature.get('properties') || {};
        const levels = properties.osm_tags?.['building:levels'];
        return levels && parseInt(levels) >= MAP_CONSTANTS.LARGE_BUILDING_MIN_LEVELS;
    },
    
    /**
     * Get configured service road minimum zoom level
     * @returns {number} - Minimum zoom level for service roads
     */
    getServiceRoadMinZoom() {
        try {
            const stored = localStorage.getItem('mapStyles');
            if (stored) {
                const styles = JSON.parse(stored);
                return styles.road?.serviceRoadMinZoom || 16;
            }
        } catch (e) {
            console.error('Error loading service road zoom setting:', e);
        }
        return 15; // Default
    },
    
    /**
     * Check if footway should be visible at given zoom level
     * @param {number} zoom - Current zoom level
     * @returns {boolean} - True if footway should be visible
     */
    shouldShowFootway(zoom) {
        try {
            const stored = localStorage.getItem('mapStyles');
            if (stored) {
                const styles = JSON.parse(stored);
                const footwaySettings = styles.footway;
                console.log(`🚶 Footway settings:`, footwaySettings, `zoom: ${zoom}`);
                if (footwaySettings) {
                    // Check if footways are enabled
                    if (footwaySettings.enabled === false) {
                        console.log(`🚶 Footways disabled`);
                        return false;
                    }
                    // Check zoom level
                    const minZoom = footwaySettings.minZoom || 16;
                    const shouldShow = zoom >= minZoom;
                    console.log(`🚶 Footway minZoom: ${minZoom}, current: ${zoom}, show: ${shouldShow}`);
                    return shouldShow;
                }
            }
        } catch (e) {
            console.error('Error loading footway settings:', e);
        }
        // Default: show footways at zoom 16+
        console.log(`🚶 Using default footway settings, zoom: ${zoom}`);
        return zoom >= 16;
    }
};

// Export for use in both editor and client
if (typeof module !== 'undefined' && module.exports) {
    // Node.js environment
    module.exports = { MAP_CONSTANTS, FEATURE_VISIBILITY };
} else {
    // Browser environment
    window.MAP_CONSTANTS = MAP_CONSTANTS;
    window.FEATURE_VISIBILITY = FEATURE_VISIBILITY;
}