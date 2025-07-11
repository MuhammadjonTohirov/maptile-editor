/**
 * Map Core for Editor
 * Handles map initialization and basic setup
 */

class MapCore {
    constructor() {
        this.map = null;
        this.vectorSource = null;
        this.vectorLayer = null;
        this.features = new Map();
    }

    initMap() {
        // Create vector source for features
        this.vectorSource = new ol.source.Vector();
        
        // Create vector layer for features
        this.vectorLayer = new ol.layer.Vector({
            source: this.vectorSource,
            style: (feature) => this.getFeatureStyle(feature)
        });

        // Initialize map
        this.map = new ol.Map({
            target: 'map',
            layers: [
                new ol.layer.Tile({
                    source: new ol.source.OSM()
                }),
                this.vectorLayer
            ],
            view: new ol.View({
                center: ol.proj.fromLonLat(MAP_CONSTANTS.DEFAULT_CENTER),
                zoom: MAP_CONSTANTS.DEFAULT_ZOOM
            })
        });

        // Add controls
        this.map.addControl(new ol.control.FullScreen());
        this.map.addControl(new ol.control.ScaleLine());

        // Update zoom display and feature visibility
        this.map.getView().on('change:resolution', () => {
            const zoom = Math.round(this.map.getView().getZoom());
            document.getElementById('current-zoom').textContent = zoom;
            this.updateFeatureVisibility();
        });

        // Handle feature selection
        this.map.on('click', (e) => {
            this.handleMapClick(e);
        });

        // Auto-center on user location
        this.getUserLocationAutomatic();

        // Add keyboard shortcuts
        this.addKeyboardShortcuts();
    }

    getFeatureStyle(feature) {
        return FeatureStyles.getFeatureStyle(feature);
    }

    updateFeatureVisibility() {
        const zoom = this.map.getView().getZoom();
        
        this.vectorLayer.setStyle((feature) => {
            const properties = feature.get('properties') || {};
            const featureType = properties.feature_type;
            
            // Hide turning_point icons at all zoom levels
            if (featureType === MAP_CONSTANTS.FEATURE_TYPES.TURNING_POINT) {
                return FeatureStyles.getFeatureStyleWithoutIcon(feature);
            }
            
            // Use shared visibility logic
            if (FEATURE_VISIBILITY.shouldShowFeature(feature, zoom)) {
                return this.getFeatureStyle(feature);
            }
            
            return null; // Hide feature
        });
    }

    handleMapClick(e) {
        // This will be set by the main editor when initialized
        if (!this.editor || !this.editor.editingEnabled || this.editor.currentDrawType) return;

        const features = this.map.getFeaturesAtPixel(e.pixel);
        if (features && features.length > 0) {
            this.editor.featureManager.selectFeature(features[0]);
        } else {
            this.editor.featureManager.clearSelection();
        }
    }

    setEditor(editor) {
        this.editor = editor;
    }

    async getUserLocationAutomatic() {
        try {
            const coords = await GeometryUtils.getUserLocation();
            this.map.getView().setCenter(ol.proj.fromLonLat(coords));
            this.map.getView().setZoom(15);
            console.log('Centered map on user location');
        } catch (error) {
            console.log('Geolocation error:', error.message);
        }
    }

    async getUserLocation() {
        const button = document.getElementById('my-location');
        const originalText = button.textContent;
        button.textContent = '🔄 Getting location...';
        button.disabled = true;

        try {
            const coords = await GeometryUtils.getUserLocation();
            
            this.map.getView().animate({
                center: ol.proj.fromLonLat(coords),
                zoom: 15,
                duration: 1000
            });
            
            button.textContent = originalText;
            button.disabled = false;
        } catch (error) {
            alert(`Geolocation error: ${error.message}`);
            button.textContent = originalText;
            button.disabled = false;
        }
    }

    addKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (!this.editor || !this.editor.editingEnabled) return;

            switch (e.key) {
                case 'p':
                case 'P':
                    if (!e.ctrlKey && !e.metaKey) {
                        this.editor.drawingTools.enableDrawing('Point');
                        e.preventDefault();
                    }
                    break;
                case 'l':
                case 'L':
                    if (!e.ctrlKey && !e.metaKey) {
                        this.editor.drawingTools.enableDrawing('LineString');
                        e.preventDefault();
                    }
                    break;
                case 'o':
                case 'O':
                    if (!e.ctrlKey && !e.metaKey) {
                        this.editor.drawingTools.enableDrawing('Polygon');
                        e.preventDefault();
                    }
                    break;
                case 'Escape':
                    this.editor.drawingTools.disableDrawing();
                    this.editor.featureManager.clearSelection();
                    e.preventDefault();
                    break;
                case 'Delete':
                case 'Backspace':
                    if (!e.target.matches('input, textarea')) {
                        this.editor.featureManager.deleteSelectedFeature();
                        e.preventDefault();
                    }
                    break;
            }
        });
    }
}

// Export for use in modules
window.MapCore = MapCore;