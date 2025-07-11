/**
 * Geometry Utilities
 * Helper functions for geometry operations
 */

class GeometryUtils {
    /**
     * Convert OpenLayers geometry to GeoJSON
     */
    static olGeometryToGeoJSON(geometry) {
        return new ol.format.GeoJSON().writeGeometryObject(geometry, {
            featureProjection: MAP_CONSTANTS.DISPLAY_PROJECTION,
            dataProjection: MAP_CONSTANTS.DATA_PROJECTION
        });
    }

    /**
     * Convert GeoJSON to OpenLayers feature
     */
    static geoJSONToOLFeature(featureData) {
        return new ol.format.GeoJSON().readFeature(featureData, {
            dataProjection: MAP_CONSTANTS.DATA_PROJECTION,
            featureProjection: MAP_CONSTANTS.DISPLAY_PROJECTION
        });
    }

    /**
     * Get center coordinates of a feature
     */
    static getFeatureCenter(feature) {
        const geometry = feature.getGeometry();
        const extent = geometry.getExtent();
        return ol.extent.getCenter(extent);
    }

    /**
     * Calculate map bounds from current view
     */
    static getMapBounds(map) {
        const extent = map.getView().calculateExtent(map.getSize());
        const [west, south, east, north] = ol.proj.transformExtent(
            extent, 
            MAP_CONSTANTS.DISPLAY_PROJECTION, 
            MAP_CONSTANTS.DATA_PROJECTION
        );
        return { north, south, east, west };
    }

    /**
     * Generate temporary ID for new features
     */
    static generateTempId() {
        return 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Check if ID is temporary
     */
    static isTempId(id) {
        return id && id.toString().startsWith('temp_');
    }

    /**
     * Transform coordinates between projections
     */
    static transformCoordinates(coordinates, fromProjection, toProjection) {
        return ol.proj.transform(coordinates, fromProjection, toProjection);
    }

    /**
     * Get user's current location
     */
    static getUserLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation not supported'));
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const coords = [position.coords.longitude, position.coords.latitude];
                    resolve(coords);
                },
                (error) => {
                    reject(error);
                },
                { timeout: 10000, enableHighAccuracy: true }
            );
        });
    }
}

// Export for use in modules
window.GeometryUtils = GeometryUtils;