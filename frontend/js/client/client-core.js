/**
 * Client Core for Vector Map Viewer
 * Handles map initialization and basic setup (view-only)
 */

class ClientCore {
    constructor() {
        this.map = null;
        this.vectorSource = null;
        this.vectorLayer = null;
        this.features = new Map();
        this.selectedFeature = null;
    }

    initMap() {
        // Create vector source for features
        this.vectorSource = new ol.source.Vector();
        
        // Create vector layer for features
        this.vectorLayer = new ol.layer.Vector({
            source: this.vectorSource,
            style: (feature) => this.getFeatureStyle(feature)
        });

        // Initialize map with vector features only (no base map)
        this.map = new ol.Map({
            target: 'map',
            layers: [
                // Only vector features layer - no base map tiles
                this.vectorLayer
            ],
            view: new ol.View({
                center: ol.proj.fromLonLat(MAP_CONSTANTS.DEFAULT_CENTER),
                zoom: MAP_CONSTANTS.DEFAULT_ZOOM
            })
        });

        // Add basic controls (no editing)
        this.map.addControl(new ol.control.ScaleLine());
        
        // Remove all default interactions except navigation
        this.map.getInteractions().clear();
        
        // Add only navigation interactions
        this.map.addInteraction(new ol.interaction.DragPan());
        this.map.addInteraction(new ol.interaction.MouseWheelZoom());
        this.map.addInteraction(new ol.interaction.DragZoom());
        this.map.addInteraction(new ol.interaction.KeyboardPan());
        this.map.addInteraction(new ol.interaction.KeyboardZoom());

        // Update zoom display and feature visibility
        this.map.getView().on('change:resolution', () => {
            const zoom = Math.round(this.map.getView().getZoom());
            document.getElementById('current-zoom').textContent = zoom;
            this.updateFeatureVisibility();
        });

        // Handle feature clicks for info display
        this.map.on('click', (e) => {
            this.handleMapClick(e);
        });

        // Auto-center on user location
        this.getUserLocation();
    }

    getFeatureStyle(feature) {
        return FeatureStyles.getFeatureStyle(feature);
    }

    updateFeatureVisibility() {
        const zoom = this.map.getView().getZoom();
        
        this.vectorLayer.setStyle((feature) => {
            // Use shared visibility logic
            if (FEATURE_VISIBILITY.shouldShowFeature(feature, zoom)) {
                return this.getFeatureStyle(feature);
            }
            
            return null; // Hide feature
        });
    }

    handleMapClick(e) {
        const features = this.map.getFeaturesAtPixel(e.pixel);
        if (features && features.length > 0) {
            window.mapClient.featureInfo.showFeatureInfo(features[0]);
        } else {
            window.mapClient.featureInfo.hideFeatureInfo();
        }
    }

    async getUserLocation() {
        try {
            const coords = await GeometryUtils.getUserLocation();
            this.map.getView().setCenter(ol.proj.fromLonLat(coords));
            this.map.getView().setZoom(15);
        } catch (error) {
            console.log('Geolocation not available:', error.message);
        }
    }
}

// Export for use in modules
window.ClientCore = ClientCore;