class MapEditor {
    constructor() {
        this.selectedFeature = null;
        this.editingEnabled = false;
        this.is3DEnabled = false;
        this.draw = null;
        this.map = null;
        this.features = new Map(); // Store features by ID
        this.pendingUpdate = null; // Store pending updates to avoid immediate saves
        this.hiddenFeatureId = null; // Track hidden feature during editing
        
        this.initMap();
        this.initControls();
        this.loadFeatures();
        this.disableEditing();
    }

    initMap() {
        // Option 1: Use custom Martin-powered style
        // this.map = new maplibregl.Map({
        //     container: 'map',
        //     style: 'http://localhost:3000/api/map-style',
        //     center: [0, 0],
        //     zoom: 2,
        //     pitch: 0,
        //     bearing: 0
        // });

        // Option 2: Use inline style (current implementation)
        this.map = new maplibregl.Map({
            container: 'map',
            style: {
                version: 8,
                sources: {
                    'osm': {
                        type: 'raster',
                        tiles: [
                            'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
                        ],
                        tileSize: 256,
                        attribution: '© OpenStreetMap contributors'
                    },
                    'features': {
                        type: 'vector',
                        tiles: ['http://localhost:3001/features/{z}/{x}/{y}'],
                        minzoom: 0,
                        maxzoom: 20
                    }
                },
                layers: [
                    {
                        id: 'osm',
                        type: 'raster',
                        source: 'osm'
                    }
                ]
            },
            center: [0, 0],
            zoom: 2,
            pitch: 0,
            bearing: 0
        });

        // Add navigation controls
        this.map.addControl(new maplibregl.NavigationControl());

        // Initialize drawing tools
        this.draw = new MapboxDraw({
            displayControlsDefault: false,
            controls: {
                point: true,
                line_string: true,
                polygon: true,
                trash: true
            }
        });

        // Update zoom display
        this.map.on('zoom', () => {
            const zoom = Math.round(this.map.getZoom());
            document.getElementById('current-zoom').textContent = zoom;
            this.updateFeatureVisibility();
        });

        // Handle feature selection
        this.map.on('click', (e) => {
            this.handleMapClick(e);
        });

        // Try to center map on user's location
        this.getUserLocationAutomatic();

        // Add keyboard shortcuts
        this.addKeyboardShortcuts();
    }

    getUserLocation() {
        if (!navigator.geolocation) {
            alert('Geolocation is not supported by this browser');
            return;
        }

        const button = document.getElementById('my-location');
        const originalText = button.textContent;
        button.textContent = '🔄 Getting location...';
        button.disabled = true;

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const coords = [position.coords.longitude, position.coords.latitude];
                
                this.map.flyTo({
                    center: coords,
                    zoom: 15,
                    duration: 1000
                });
                
                button.textContent = originalText;
                button.disabled = false;
            },
            (error) => {
                let errorMessage = 'Could not get your location: ';
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        errorMessage += 'Permission denied.';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMessage += 'Location unavailable.';
                        break;
                    case error.TIMEOUT:
                        errorMessage += 'Request timeout.';
                        break;
                    default:
                        errorMessage += 'Unknown error.';
                        break;
                }
                alert(errorMessage);
                button.textContent = originalText;
                button.disabled = false;
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 60000
            }
        );
    }

    getUserLocationAutomatic() {
        if (!navigator.geolocation) return;

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const coords = [position.coords.longitude, position.coords.latitude];
                this.map.setCenter(coords);
                this.map.setZoom(13);
            },
            (error) => {
                console.log('Automatic geolocation failed:', error.message);
            },
            {
                enableHighAccuracy: false,
                timeout: 10000,
                maximumAge: 300000
            }
        );
    }

    initControls() {
        // Editing toggle
        document.getElementById('toggle-editing').addEventListener('click', () => {
            this.toggleEditing();
        });

        // 3D toggle
        document.getElementById('toggle-3d').addEventListener('click', () => {
            this.toggle3D();
        });

        // Drawing tools
        document.getElementById('draw-point').addEventListener('click', () => {
            this.setDrawingMode('draw_point');
        });

        document.getElementById('draw-line').addEventListener('click', () => {
            this.setDrawingMode('draw_line_string');
        });

        document.getElementById('draw-polygon').addEventListener('click', () => {
            this.setDrawingMode('draw_polygon');
        });

        document.getElementById('select').addEventListener('click', () => {
            this.setDrawingMode('simple_select');
        });

        // Delete button moved to feature properties panel

        // Data operations
        document.getElementById('clear-all').addEventListener('click', () => {
            this.clearAllFeatures();
        });

        document.getElementById('save-all').addEventListener('click', () => {
            this.saveAllFeatures();
        });

        document.getElementById('load-features').addEventListener('click', () => {
            this.loadFeatures();
        });

        // Feature editing
        document.getElementById('save-feature').addEventListener('click', () => {
            this.saveSelectedFeature();
        });

        document.getElementById('cancel-edit').addEventListener('click', () => {
            this.hideFeatureInfo();
        });

        document.getElementById('delete-feature').addEventListener('click', () => {
            this.deleteSelectedFeature();
        });

        // Location
        document.getElementById('my-location').addEventListener('click', () => {
            this.getUserLocation();
        });

        // OSM data loading
        document.getElementById('load-buildings').addEventListener('click', () => {
            this.loadOSMBuildings();
        });

        document.getElementById('load-roads').addEventListener('click', () => {
            this.loadOSMRoads();
        });

        document.getElementById('load-streetlights').addEventListener('click', () => {
            this.loadOSMStreetlights();
        });

        document.getElementById('load-traffic-lights').addEventListener('click', () => {
            this.loadOSMTrafficLights();
        });
    }

    toggle3D() {
        this.is3DEnabled = !this.is3DEnabled;
        const button = document.getElementById('toggle-3d');
        
        if (this.is3DEnabled) {
            // Enable 3D mode
            this.map.easeTo({
                pitch: 60,
                bearing: 0,
                duration: 1000
            });
            button.textContent = '🌍 Disable 3D';
            button.classList.add('editing-enabled');
            
            // Add building extrusions
            this.addBuildingExtrusions();
        } else {
            // Disable 3D mode
            this.map.easeTo({
                pitch: 0,
                bearing: 0,
                duration: 1000
            });
            button.textContent = '🏢 Enable 3D';
            button.classList.remove('editing-enabled');
            
            // Remove building extrusions
            this.removeBuildingExtrusions();
        }
    }

    addBuildingExtrusions() {
        // Add 3D building layer if it doesn't exist
        if (!this.map.getLayer('buildings-3d')) {
            this.map.addLayer({
                id: 'buildings-3d',
                type: 'fill-extrusion',
                source: 'features',
                filter: ['==', ['geometry-type'], 'Polygon'],
                paint: {
                    'fill-extrusion-color': [
                        'case',
                        ['has', 'building_type'],
                        [
                            'match',
                            ['get', 'building_type'],
                            'residential', '#4a90e2',
                            'commercial', '#f5a623',
                            'industrial', '#bd10e0',
                            'office', '#50e3c2',
                            '#7ed321' // default
                        ],
                        '#cccccc'
                    ],
                    'fill-extrusion-height': [
                        'case',
                        ['has', 'height'],
                        ['get', 'height'],
                        [
                            'case',
                            ['has', 'building_type'],
                            [
                                'match',
                                ['get', 'building_type'],
                                'residential', 15,
                                'commercial', 25,
                                'industrial', 12,
                                'office', 40,
                                20 // default
                            ],
                            10
                        ]
                    ],
                    'fill-extrusion-base': 0,
                    'fill-extrusion-opacity': 0.8
                }
            });
        }
    }

    removeBuildingExtrusions() {
        if (this.map.getLayer('buildings-3d')) {
            this.map.removeLayer('buildings-3d');
        }
    }

    setDrawingMode(mode) {
        if (!this.editingEnabled && ['draw_point', 'draw_line_string', 'draw_polygon'].includes(mode)) {
            alert('Please enable editing first by clicking the "🔒 Lock Editing" button');
            return;
        }

        // Clear active states
        document.querySelectorAll('.controls button').forEach(btn => {
            btn.classList.remove('active');
        });

        // Set new mode
        this.draw.changeMode(mode);

        // Update button state
        const buttonMap = {
            'draw_point': 'draw-point',
            'draw_line_string': 'draw-line',
            'draw_polygon': 'draw-polygon',
            'simple_select': 'select'
        };

        const buttonId = buttonMap[mode];
        if (buttonId) {
            document.getElementById(buttonId).classList.add('active');
        }
    }

    toggleEditing() {
        this.editingEnabled = !this.editingEnabled;
        const button = document.getElementById('toggle-editing');
        
        if (this.editingEnabled) {
            this.enableEditing();
            button.textContent = '🔓 Unlock Editing';
            button.classList.add('editing-enabled');
        } else {
            this.disableEditing();
            button.textContent = '🔒 Lock Editing';
            button.classList.remove('editing-enabled');
        }
    }

    enableEditing() {
        // Add drawing controls to map
        this.map.addControl(this.draw);
        
        // Enable drawing tools
        document.querySelectorAll('#draw-point, #draw-line, #draw-polygon').forEach(btn => {
            btn.disabled = false;
            btn.style.opacity = '1';
        });

        // Add drawing event listeners
        this.map.on('draw.create', (e) => {
            this.handleFeatureCreate(e);
        });

        this.map.on('draw.update', (e) => {
            this.handleFeatureUpdate(e);
            // Update midpoint handles when vertices are moved
            this.updateMidpointHandles(e.features[0]);
        });

        this.map.on('draw.delete', (e) => {
            this.handleFeatureDelete(e);
        });

        // Add listener for mode changes to clean up midpoints when not in direct select
        this.map.on('draw.modechange', (e) => {
            // Save any pending updates when leaving direct select mode
            if (e.mode !== 'direct_select' && this.pendingUpdate) {
                this.savePendingUpdate();
            }
            
            if (e.mode !== 'direct_select') {
                this.cleanupMidpointHandles();
            }
        });
    }

    disableEditing() {
        // Save any pending updates before disabling
        if (this.pendingUpdate) {
            this.savePendingUpdate();
        }
        
        // Clear any features being edited
        if (this.draw) {
            this.draw.deleteAll();
            this.map.removeControl(this.draw);
        }
        
        // Clean up midpoint handles
        this.cleanupMidpointHandles();
        
        // Disable drawing tools
        document.querySelectorAll('#draw-point, #draw-line, #draw-polygon').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
        });

        // Clear active states
        document.querySelectorAll('.controls button').forEach(btn => {
            btn.classList.remove('active');
        });

        // Remove click handlers by clearing event listeners
        this.removeLayerClickHandlers();
        
        // Clear any selection
        this.clearHighlight();
        this.hideFeatureInfo();
    }

    cleanupMidpointHandles() {
        // Remove midpoint layer and source
        if (this.map.getSource('midpoints')) {
            this.map.removeLayer('midpoints');
            this.map.removeSource('midpoints');
        }
        
        // Remove custom vertex styles
        const existingStyle = document.getElementById('vertex-custom-styles');
        if (existingStyle) {
            existingStyle.remove();
        }
        
        // Restore original feature visibility
        this.showOriginalFeature();
    }

    updateMidpointHandles(feature) {
        // Only update if we're in direct select mode and have line/polygon
        if (feature && (feature.geometry.type === 'LineString' || feature.geometry.type === 'Polygon')) {
            this.addMidpointHandles(feature);
        }
    }

    async savePendingUpdate() {
        if (this.pendingUpdate) {
            console.log('Saving pending update for feature:', this.pendingUpdate.featureId);
            await this.updateExistingFeature(this.pendingUpdate.featureId, this.pendingUpdate.updatedFeature);
            this.pendingUpdate = null;
        }
    }

    addKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Delete key for deleting selected features
            if (e.key === 'Delete' || e.key === 'Backspace') {
                // Prevent default only if we have a feature to delete
                const hasSelectedFeature = this.selectedFeature || this.draw.getAll().features.length > 0;
                if (hasSelectedFeature && this.editingEnabled) {
                    e.preventDefault();
                    this.deleteSelectedFeature();
                }
            }
            
            // Escape key to deselect
            if (e.key === 'Escape') {
                this.hideFeatureInfo();
                this.draw.deleteAll();
            }
        });
    }

    removeLayerClickHandlers() {
        // Reset cursor
        this.map.getCanvas().style.cursor = '';
        
        // Note: MapLibre doesn't have a direct way to remove specific event listeners
        // The handlers will be disabled by the editing state check
    }

    addLayerClickHandlers() {
        // List of all our feature layer IDs that should be clickable
        const clickableLayers = [
            'buildings', 'roads', 'streetlights', 'traffic-lights', 
            'points', 'lines', 'debug-all-lines'
        ];

        clickableLayers.forEach(layerId => {
            if (this.map.getLayer(layerId)) {
                // Add click handler for each layer
                this.map.on('click', layerId, (e) => {
                    this.handleFeatureClick(e);
                });

                // Change cursor to pointer when hovering
                this.map.on('mouseenter', layerId, () => {
                    this.map.getCanvas().style.cursor = 'pointer';
                });

                this.map.on('mouseleave', layerId, () => {
                    this.map.getCanvas().style.cursor = '';
                });
            }
        });
    }

    handleFeatureClick(e) {
        // Prevent map click event
        e.preventDefault();
        
        const feature = e.features[0];
        if (feature && feature.source === 'features') {
            this.selectedFeature = feature;
            this.showFeatureInfo(feature);
            
            // Highlight the selected feature
            this.highlightFeature(feature);
            
            // If editing is enabled, add the feature to draw for editing
            if (this.editingEnabled) {
                this.makeFeatureEditable(feature);
            }
            
            console.log('Selected feature:', feature);
        }
    }

    makeFeatureEditable(feature) {
        try {
            // Clear any existing features in draw
            this.draw.deleteAll();
            
            // Hide the original feature to prevent duplication
            this.hideOriginalFeature(feature.properties.id);
            
            // Create a new feature for the draw layer
            const editableFeature = {
                type: 'Feature',
                geometry: feature.geometry,
                properties: {
                    ...feature.properties,
                    originalId: feature.properties.id // Store original ID for updating
                }
            };
            
            // Add to draw layer for editing
            this.draw.add(editableFeature);
            
            // Switch to direct select mode for better vertex editing
            this.draw.changeMode('direct_select', {
                featureId: this.draw.getAll().features[0].id
            });
            
            // Add custom vertex editing enhancements
            this.enhanceVertexEditing(editableFeature);
            
            // Show visual feedback that feature is now editable
            this.showEditingFeedback();
            
            console.log('Feature made editable:', editableFeature);
            
        } catch (error) {
            console.error('Error making feature editable:', error);
        }
    }

    hideOriginalFeature(featureId) {
        // Create a filter to hide the specific feature being edited
        const allLayers = ['buildings', 'buildings-outline', 'roads', 'streetlights', 'streetlights-bg', 
                          'traffic-lights', 'traffic-lights-bg', 'points', 'lines', 'debug-all-lines'];
        
        allLayers.forEach(layerId => {
            if (this.map.getLayer(layerId)) {
                const currentFilter = this.map.getFilter(layerId) || ['==', ['geometry-type'], 'Point'];
                // Add condition to exclude the feature being edited
                const newFilter = ['all', currentFilter, ['!=', ['get', 'id'], featureId]];
                this.map.setFilter(layerId, newFilter);
            }
        });
        
        // Store the hidden feature ID
        this.hiddenFeatureId = featureId;
    }

    showOriginalFeature() {
        // Restore original filters to show all features
        if (this.hiddenFeatureId) {
            this.restoreLayerFilters();
            this.hiddenFeatureId = null;
        }
    }

    restoreLayerFilters() {
        // Restore original layer filters
        const layerFilters = {
            'buildings': ['==', ['geometry-type'], 'Polygon'],
            'buildings-outline': ['==', ['geometry-type'], 'Polygon'],
            'roads': ['all', ['==', ['geometry-type'], 'LineString'], ['has', 'road_type']],
            'streetlights': ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'feature_type'], 'streetlight']],
            'streetlights-bg': ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'feature_type'], 'streetlight']],
            'traffic-lights': ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'feature_type'], 'traffic_light']],
            'traffic-lights-bg': ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'feature_type'], 'traffic_light']],
            'points': ['all', ['==', ['geometry-type'], 'Point'], ['!has', 'feature_type']],
            'lines': ['all', ['==', ['geometry-type'], 'LineString'], ['!has', 'road_type']],
            'debug-all-lines': ['==', ['geometry-type'], 'LineString']
        };

        Object.entries(layerFilters).forEach(([layerId, filter]) => {
            if (this.map.getLayer(layerId)) {
                this.map.setFilter(layerId, filter);
            }
        });
    }

    enhanceVertexEditing(feature) {
        // Add midpoint handles for lines and polygons
        if (feature.geometry.type === 'LineString' || feature.geometry.type === 'Polygon') {
            this.addMidpointHandles(feature);
        }
        
        // Customize vertex appearance
        this.customizeVertexAppearance();
    }

    addMidpointHandles(feature) {
        const coordinates = feature.geometry.type === 'Polygon' 
            ? feature.geometry.coordinates[0] 
            : feature.geometry.coordinates;

        // Remove existing midpoint source if it exists
        if (this.map.getSource('midpoints')) {
            this.map.removeLayer('midpoints');
            this.map.removeSource('midpoints');
        }

        // Calculate midpoints between vertices
        const midpoints = [];
        for (let i = 0; i < coordinates.length - 1; i++) {
            const current = coordinates[i];
            const next = coordinates[i + 1];
            
            const midpoint = [
                (current[0] + next[0]) / 2,
                (current[1] + next[1]) / 2
            ];
            
            midpoints.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: midpoint
                },
                properties: {
                    type: 'midpoint',
                    insertIndex: i + 1
                }
            });
        }

        // Add midpoints source and layer
        this.map.addSource('midpoints', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: midpoints
            }
        });

        this.map.addLayer({
            id: 'midpoints',
            type: 'circle',
            source: 'midpoints',
            paint: {
                'circle-color': '#ffffff',
                'circle-stroke-color': '#007cba',
                'circle-stroke-width': 3,
                'circle-radius': 6,
                'circle-opacity': 0.8
            }
        });

        // Add click handler for midpoints
        this.map.on('click', 'midpoints', (e) => {
            this.handleMidpointClick(e);
        });

        // Change cursor on hover
        this.map.on('mouseenter', 'midpoints', () => {
            this.map.getCanvas().style.cursor = 'pointer';
        });

        this.map.on('mouseleave', 'midpoints', () => {
            this.map.getCanvas().style.cursor = '';
        });
    }

    handleMidpointClick(e) {
        e.preventDefault();
        const midpointFeature = e.features[0];
        const insertIndex = midpointFeature.properties.insertIndex;
        const newCoordinate = midpointFeature.geometry.coordinates;

        // Get the current feature being edited
        const drawFeatures = this.draw.getAll().features;
        if (drawFeatures.length > 0) {
            const feature = drawFeatures[0];
            const coordinates = feature.geometry.type === 'Polygon' 
                ? feature.geometry.coordinates[0] 
                : feature.geometry.coordinates;

            // Insert new coordinate at the specified index
            coordinates.splice(insertIndex, 0, newCoordinate);

            // Update the feature geometry
            if (feature.geometry.type === 'Polygon') {
                feature.geometry.coordinates[0] = coordinates;
            } else {
                feature.geometry.coordinates = coordinates;
            }

            // Update the draw feature
            this.draw.delete(feature.id);
            this.draw.add(feature);

            // Switch back to direct select mode
            this.draw.changeMode('direct_select', {
                featureId: this.draw.getAll().features[0].id
            });

            // Refresh midpoint handles
            this.addMidpointHandles(feature);

            console.log('Vertex added at midpoint');
        }
    }

    customizeVertexAppearance() {
        // Add custom styles for better vertex visibility
        const style = document.createElement('style');
        style.textContent = `
            .mapboxgl-ctrl-group .mapbox-gl-draw_polygon,
            .mapboxgl-ctrl-group .mapbox-gl-draw_line,
            .mapboxgl-ctrl-group .mapbox-gl-draw_point {
                background-color: #007cba !important;
            }
            
            .mapbox-gl-draw_vertex.mapbox-gl-draw_vertex-active {
                background-color: #ff6b35 !important;
                border: 3px solid #ffffff !important;
                border-radius: 50% !important;
                width: 12px !important;
                height: 12px !important;
                cursor: grab !important;
            }
            
            .mapbox-gl-draw_vertex.mapbox-gl-draw_vertex-active:hover {
                background-color: #ff4500 !important;
                cursor: grabbing !important;
            }
            
            .mapbox-gl-draw_vertex {
                background-color: #007cba !important;
                border: 2px solid #ffffff !important;
                border-radius: 50% !important;
                width: 10px !important;
                height: 10px !important;
                cursor: grab !important;
            }
            
            .mapbox-gl-draw_vertex:hover {
                background-color: #0056b3 !important;
                cursor: grabbing !important;
            }
        `;
        
        // Remove existing custom styles
        const existingStyle = document.getElementById('vertex-custom-styles');
        if (existingStyle) {
            existingStyle.remove();
        }
        
        style.id = 'vertex-custom-styles';
        document.head.appendChild(style);
    }

    highlightFeature(feature) {
        // Remove previous highlight
        if (this.map.getSource('selected-feature')) {
            this.map.removeLayer('selected-feature-highlight');
            this.map.removeSource('selected-feature');
        }

        // Add highlight source and layer
        this.map.addSource('selected-feature', {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: feature.geometry,
                properties: feature.properties
            }
        });

        // Add different highlight styles based on geometry type
        const geometryType = feature.geometry.type;
        
        if (geometryType === 'Point') {
            this.map.addLayer({
                id: 'selected-feature-highlight',
                type: 'circle',
                source: 'selected-feature',
                paint: {
                    'circle-color': 'transparent',
                    'circle-stroke-color': '#ff6b35',
                    'circle-stroke-width': 4,
                    'circle-radius': 15
                }
            });
        } else if (geometryType === 'LineString') {
            this.map.addLayer({
                id: 'selected-feature-highlight',
                type: 'line',
                source: 'selected-feature',
                paint: {
                    'line-color': '#ff6b35',
                    'line-width': 6,
                    'line-opacity': 0.8
                }
            });
        } else if (geometryType === 'Polygon') {
            this.map.addLayer({
                id: 'selected-feature-highlight',
                type: 'line',
                source: 'selected-feature',
                paint: {
                    'line-color': '#ff6b35',
                    'line-width': 4,
                    'line-opacity': 1
                }
            });
        }
    }

    handleMapClick(e) {
        // Only handle general map clicks when not clicking on features
        const features = this.map.queryRenderedFeatures(e.point);
        const hasFeatureLayer = features.some(f => f.source === 'features');
        
        if (!hasFeatureLayer) {
            // Save any pending updates before clearing selection
            if (this.pendingUpdate) {
                this.savePendingUpdate();
            }
            
            this.selectedFeature = null;
            this.hideFeatureInfo();
            this.clearHighlight();
        }
    }

    clearHighlight() {
        if (this.map.getSource('selected-feature')) {
            this.map.removeLayer('selected-feature-highlight');
            this.map.removeSource('selected-feature');
        }
    }

    showEditingFeedback() {
        // Show a temporary message that the feature is now editable
        const feedback = document.createElement('div');
        feedback.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 124, 186, 0.9);
            color: white;
            padding: 15px 25px;
            border-radius: 5px;
            font-weight: bold;
            z-index: 10000;
            pointer-events: none;
        `;
        feedback.textContent = '✏️ Feature is now editable! Drag vertices to modify.';
        document.body.appendChild(feedback);
        
        // Remove after 3 seconds
        setTimeout(() => {
            if (feedback.parentNode) {
                feedback.parentNode.removeChild(feedback);
            }
        }, 3000);
    }

    handleFeatureCreate(e) {
        const feature = e.features[0];
        console.log('New feature created:', feature);
        
        // Convert the draw feature to our feature format
        const newFeature = {
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
                name: '',
                description: '',
                id: null // Will be set when saved to server
            }
        };
        
        this.selectedFeature = newFeature;
        this.showFeatureInfo(newFeature);
        
        // Auto-save the new feature to server
        this.autoSaveDrawnFeature(newFeature, feature.id);
    }

    async autoSaveDrawnFeature(feature, drawId) {
        const featureData = {
            name: feature.properties.name || 'New Feature',
            description: feature.properties.description || '',
            geometry: feature.geometry,
            properties: feature.properties
        };

        try {
            const response = await fetch('/api/features', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(featureData)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('Feature auto-saved:', result);
                
                // Update the feature with the server ID
                feature.properties.id = result.id;
                this.selectedFeature.properties.id = result.id;
                
                // Remove from draw and reload features
                this.draw.delete(drawId);
                await this.loadFeatures();
                
            } else {
                console.error('Failed to auto-save feature');
            }
        } catch (error) {
            console.error('Error auto-saving feature:', error);
        }
    }

    handleFeatureUpdate(e) {
        const feature = e.features[0];
        console.log('Feature updated:', feature);
        
        // Check if this is an existing feature being modified
        const originalId = feature.properties.originalId;
        
        if (originalId) {
            // For existing features, just store the changes temporarily
            // We'll save when user finishes editing (on mode change or click away)
            this.pendingUpdate = {
                featureId: originalId,
                updatedFeature: feature
            };
            console.log('Pending update stored for feature:', originalId);
        } else {
            // New feature being modified
            this.autoSaveModifiedFeature(feature);
        }
    }

    async updateExistingFeature(featureId, updatedFeature) {
        const featureData = {
            name: updatedFeature.properties.name || '',
            description: updatedFeature.properties.description || '',
            geometry: updatedFeature.geometry,
            properties: updatedFeature.properties,
            building_number: updatedFeature.properties.building_number || '',
            building_type: updatedFeature.properties.building_type || '',
            icon: updatedFeature.properties.icon || '',
            osm_id: updatedFeature.properties.osm_id || null,
            road_type: updatedFeature.properties.road_type || '',
            direction: updatedFeature.properties.direction || '',
            lane_count: updatedFeature.properties.lane_count || null,
            max_speed: updatedFeature.properties.max_speed || null,
            surface: updatedFeature.properties.surface || ''
        };

        try {
            const response = await fetch(`/api/features/${featureId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(featureData)
            });

            if (response.ok) {
                console.log('Feature updated successfully');
                
                // Clear the draw layer first to prevent duplicates
                this.draw.deleteAll();
                
                // Clean up editing UI
                this.cleanupMidpointHandles();
                this.clearHighlight();
                
                // Restore original feature visibility
                this.showOriginalFeature();
                
                // Reload features to show the updated geometry
                await this.loadFeatures();
                
                // Clear selected feature since editing is done
                this.selectedFeature = null;
                
            } else {
                const errorText = await response.text();
                console.error('Failed to update feature:', response.status, errorText);
            }
        } catch (error) {
            console.error('Error updating feature:', error);
        }
    }

    handleFeatureDelete(e) {
        e.features.forEach(feature => {
            const featureId = feature.properties.id || feature.properties.originalId;
            if (featureId) {
                this.deleteFeatureFromServer(featureId);
            }
        });
    }

    async loadFeatures() {
        try {
            // Martin vector tiles are loaded automatically via the vector source
            // We still load feature data for the in-memory storage and properties editing
            const response = await fetch('/api/features');
            
            if (response.ok) {
                const geoJsonData = await response.json();
                
                // The vector source is already defined in the map style, so we just need to add layers
                if (!this.map.getLayer('buildings')) {
                    this.addFeatureLayers();
                    
                    // Add click handlers for feature interaction
                    this.addLayerClickHandlers();
                }
                
                // Store features in memory for properties editing
                this.features.clear();
                geoJsonData.features.forEach(feature => {
                    this.features.set(feature.id, feature);
                });
                
                console.log(`Loaded ${geoJsonData.features.length} features via Martin vector tiles`);
            } else {
                console.error('Failed to load features');
            }
        } catch (error) {
            console.error('Error loading features:', error);
        }
    }

    addFeatureLayers() {
        // Add building polygons - now using vector tiles from Martin
        this.map.addLayer({
            id: 'buildings',
            type: 'fill',
            source: 'features',
            'source-layer': 'features', // Martin creates this layer automatically
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: {
                'fill-color': [
                    'case',
                    ['has', 'building_type'],
                    [
                        'match',
                        ['get', 'building_type'],
                        'residential', '#4a90e2',
                        'commercial', '#f5a623', 
                        'industrial', '#bd10e0',
                        'office', '#50e3c2',
                        '#7ed321'
                    ],
                    '#007cba'
                ],
                'fill-opacity': 0.3
            }
        });

        // Add building outlines
        this.map.addLayer({
            id: 'buildings-outline',
            type: 'line',
            source: 'features',
            'source-layer': 'features',
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: {
                'line-color': '#007cba',
                'line-width': 2
            }
        });

        // Add roads - simplified filter for debugging
        this.map.addLayer({
            id: 'roads',
            type: 'line',
            source: 'features',
            'source-layer': 'features',
            filter: ['all', 
                ['==', ['geometry-type'], 'LineString'],
                ['has', 'road_type']
            ],
            paint: {
                'line-color': [
                    'case',
                    ['has', 'road_type'],
                    [
                        'match',
                        ['get', 'road_type'],
                        'motorway', '#e892a2',
                        'trunk', '#f9b29c',
                        'primary', '#fcd6a4',
                        'secondary', '#f7fabf',
                        'tertiary', '#ffffff',
                        'residential', '#e8e8e8',
                        'service', '#cccccc',
                        'footway', '#fa8072',
                        'path', '#fa8072',
                        'cycleway', '#fa8072',
                        'steps', '#fe9a76',
                        '#999999'
                    ],
                    '#ff0000' // bright red for debugging - should not appear
                ],
                'line-width': [
                    'case',
                    ['has', 'road_type'],
                    [
                        'match',
                        ['get', 'road_type'],
                        'motorway', 8,
                        'trunk', 7,
                        'primary', 6,
                        'secondary', 5,
                        'tertiary', 4,
                        'residential', 3,
                        'service', 2,
                        'footway', 2,
                        'path', 2,
                        'cycleway', 2,
                        'steps', 2,
                        3
                    ],
                    4 // default width
                ]
            }
        });

        // Add street lights with symbols
        this.map.addLayer({
            id: 'streetlights-bg',
            type: 'circle',
            source: 'features',
            'source-layer': 'features',
            filter: ['all',
                ['==', ['geometry-type'], 'Point'],
                ['==', ['get', 'feature_type'], 'streetlight']
            ],
            paint: {
                'circle-color': '#ffff00',
                'circle-radius': 10,
                'circle-stroke-color': '#ff8c00',
                'circle-stroke-width': 2,
                'circle-opacity': 0.8
            }
        });

        // Add street light text symbols
        this.map.addLayer({
            id: 'streetlights',
            type: 'symbol',
            source: 'features',
            'source-layer': 'features',
            filter: ['all',
                ['==', ['geometry-type'], 'Point'],
                ['==', ['get', 'feature_type'], 'streetlight']
            ],
            layout: {
                'text-field': '💡',
                'text-size': 14,
                'text-allow-overlap': true,
                'text-ignore-placement': true
            },
            paint: {
                'text-color': '#000000'
            }
        });

        // Add traffic lights with symbols
        this.map.addLayer({
            id: 'traffic-lights-bg',
            type: 'circle',
            source: 'features',
            'source-layer': 'features',
            filter: ['all',
                ['==', ['geometry-type'], 'Point'],
                ['==', ['get', 'feature_type'], 'traffic_light']
            ],
            paint: {
                'circle-color': '#ff0000',
                'circle-radius': 12,
                'circle-stroke-color': '#8B0000',
                'circle-stroke-width': 3,
                'circle-opacity': 0.8
            }
        });

        // Add traffic light text symbols
        this.map.addLayer({
            id: 'traffic-lights',
            type: 'symbol',
            source: 'features',
            'source-layer': 'features',
            filter: ['all',
                ['==', ['geometry-type'], 'Point'],
                ['==', ['get', 'feature_type'], 'traffic_light']
            ],
            layout: {
                'text-field': '🚦',
                'text-size': 16,
                'text-allow-overlap': true,
                'text-ignore-placement': true
            },
            paint: {
                'text-color': '#000000'
            }
        });

        // Add other points
        this.map.addLayer({
            id: 'points',
            type: 'circle',
            source: 'features',
            'source-layer': 'features',
            filter: ['all',
                ['==', ['geometry-type'], 'Point'],
                ['!has', 'feature_type']
            ],
            paint: {
                'circle-color': '#007cba',
                'circle-radius': 6,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2
            }
        });

        // Add debug layer for all LineStrings
        this.map.addLayer({
            id: 'debug-all-lines',
            type: 'line',
            source: 'features',
            'source-layer': 'features',
            filter: ['==', ['geometry-type'], 'LineString'],
            paint: {
                'line-color': '#00ff00', // bright green for debugging
                'line-width': 2,
                'line-opacity': 0.5
            }
        });

        // Add other lines
        this.map.addLayer({
            id: 'lines',
            type: 'line',
            source: 'features',
            'source-layer': 'features',
            filter: ['all',
                ['==', ['geometry-type'], 'LineString'],
                ['!has', 'road_type']
            ],
            paint: {
                'line-color': '#007cba',
                'line-width': 3
            }
        });
    }

    updateFeatureVisibility() {
        const zoom = this.map.getZoom();
        
        // Update layer visibility based on zoom
        const layerVisibility = {
            'roads': zoom >= 10,
            'debug-all-lines': zoom >= 8, // Show debug lines early
            'buildings': zoom >= 15,
            'buildings-outline': zoom >= 15,
            'streetlights': zoom >= 16,
            'streetlights-bg': zoom >= 16,
            'traffic-lights': zoom >= 14,
            'traffic-lights-bg': zoom >= 14,
            'points': zoom >= 13,
            'lines': zoom >= 13
        };

        Object.entries(layerVisibility).forEach(([layerId, visible]) => {
            if (this.map.getLayer(layerId)) {
                this.map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
            }
        });
    }

    showFeatureInfo(feature) {
        const properties = feature.properties || {};
        document.getElementById('feature-name').value = properties.name || '';
        document.getElementById('feature-description').value = properties.description || '';
        document.getElementById('building-number').value = properties.building_number || '';
        document.getElementById('building-type').value = properties.building_type || '';
        document.getElementById('building-icon').value = properties.icon || '';
        document.getElementById('feature-info').style.display = 'block';
    }


    hideFeatureInfo() {
        // Save any pending updates before hiding
        if (this.pendingUpdate) {
            this.savePendingUpdate();
        }
        
        document.getElementById('feature-info').style.display = 'none';
        this.clearHighlight();
        this.cleanupMidpointHandles();
        this.selectedFeature = null;
    }

    deleteSelectedFeature() {
        if (!this.editingEnabled) {
            alert('Please enable editing first by clicking the "🔒 Lock Editing" button');
            return;
        }

        if (!this.selectedFeature) {
            alert('No feature selected. Please click on a feature first.');
            return;
        }

        const featureName = this.selectedFeature.properties.name || 'Unnamed Feature';
        const featureId = this.selectedFeature.properties.id;
        console.log('Selected feature:', this.selectedFeature.properties);
        console.log('Attempting to delete feature:', {
            id: featureId,
            name: featureName,
            feature: this.selectedFeature
        });

        if (!featureId) {
            alert('Cannot delete feature: No ID found. This might be a newly created feature that hasn\'t been saved yet.');
            return;
        }

        if (confirm(`Are you sure you want to delete "${featureName}"?`)) {
            this.deleteFeatureFromServer(featureId);
        }
    }

    async clearAllFeatures() {
        if (confirm('Are you sure you want to clear all features? This will delete ALL features from the database permanently.')) {
            try {
                // Delete all features from the database
                const response = await fetch('/api/features/clear-all', {
                    method: 'DELETE'
                });

                if (response.ok) {
                    console.log('All features cleared from database');
                    
                    // Clear local memory
                    this.features.clear();
                    
                    // Hide any open feature info panels
                    this.hideFeatureInfo();
                    
                    // Clear any drawing features
                    if (this.draw) {
                        this.draw.deleteAll();
                    }
                    
                    // Clear any highlights
                    this.clearHighlight();
                    
                    // Martin vector tiles will automatically update since database is cleared
                    console.log('Map cleared successfully - Martin tiles will refresh automatically');
                    
                    alert('All features cleared successfully!');
                } else {
                    const errorText = await response.text();
                    console.error('Failed to clear features:', response.status, errorText);
                    alert(`Failed to clear features: ${response.status} - ${errorText}`);
                }
            } catch (error) {
                console.error('Error clearing features:', error);
                alert('Error clearing features. Please try again.');
            }
        }
    }

    async saveSelectedFeature() {
        if (!this.selectedFeature) return;

        const name = document.getElementById('feature-name').value;
        const description = document.getElementById('feature-description').value;
        const buildingNumber = document.getElementById('building-number').value;
        const buildingType = document.getElementById('building-type').value;
        const icon = document.getElementById('building-icon').value;
        
        const featureData = {
            name: name,
            description: description,
            geometry: this.selectedFeature.geometry,
            properties: {
                name: name,
                description: description,
                building_number: buildingNumber,
                building_type: buildingType,
                icon: icon,
                ...this.selectedFeature.properties
            },
            building_number: buildingNumber,
            building_type: buildingType,
            icon: icon,
            osm_id: this.selectedFeature.properties.osm_id || null
        };

        const featureId = this.selectedFeature.properties.id;
        
        if (featureId) {
            await this.updateFeatureOnServer(featureId, featureData);
        } else {
            await this.createFeatureOnServer(featureData);
        }

        this.hideFeatureInfo();
    }

    async autoSaveModifiedFeature(feature) {
        const properties = feature.properties || {};
        
        const featureData = {
            name: properties.name || '',
            description: properties.description || '',
            geometry: feature.geometry,
            properties: properties,
            building_number: properties.building_number || '',
            building_type: properties.building_type || '',
            icon: properties.icon || '',
            osm_id: properties.osm_id || null
        };

        const featureId = properties.id;
        
        if (featureId) {
            await this.updateFeatureOnServer(featureId, featureData);
        } else {
            await this.createFeatureOnServer(featureData);
        }
    }

    async createFeatureOnServer(featureData) {
        try {
            const response = await fetch('/api/features', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(featureData)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('Feature created successfully:', result);
                // Reload features to update the map
                await this.loadFeatures();
            } else {
                const errorText = await response.text();
                console.error('Failed to create feature:', response.status, errorText);
            }
        } catch (error) {
            console.error('Error creating feature:', error);
        }
    }

    async updateFeatureOnServer(featureId, featureData) {
        try {
            const response = await fetch(`/api/features/${featureId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(featureData)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('Feature updated successfully:', result);
            } else {
                const errorText = await response.text();
                console.error('Failed to update feature:', response.status, errorText);
            }
        } catch (error) {
            console.error('Error updating feature:', error);
        }
    }

    async deleteFeatureFromServer(featureId) {
        try {
            console.log('Sending DELETE request for feature ID:', featureId);
            const response = await fetch(`/api/features/${featureId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                console.log('Feature deleted successfully from server');
                
                // Clean up all editing state
                this.draw.deleteAll();
                this.showOriginalFeature();
                this.cleanupMidpointHandles();
                this.clearHighlight();
                
                // Hide feature info panel
                this.hideFeatureInfo();
                
                // Reload features to reflect deletion
                await this.loadFeatures();
                
                // Clear selection
                this.selectedFeature = null;
                
                console.log('Feature deletion completed successfully');
                
            } else {
                const errorText = await response.text();
                console.error('Failed to delete feature:', response.status, errorText);
                alert(`Failed to delete feature: ${response.status} - ${errorText}`);
            }
        } catch (error) {
            console.error('Error deleting feature:', error);
            alert('Error deleting feature. Please try again.');
        }
    }

    async saveAllFeatures() {
        const features = Array.from(this.features.values());
        let savedCount = 0;
        
        for (const feature of features) {
            try {
                const featureId = feature.id;
                const featureData = {
                    name: feature.properties.name || '',
                    description: feature.properties.description || '',
                    geometry: feature.geometry,
                    properties: feature.properties
                };

                if (featureId) {
                    await this.updateFeatureOnServer(featureId, featureData);
                } else {
                    await this.createFeatureOnServer(featureData);
                }
                savedCount++;
            } catch (error) {
                console.error('Error saving feature:', error);
            }
        }
        
        alert(`Saved ${savedCount} features`);
    }

    async loadOSMBuildings() {
        const bounds = this.map.getBounds();
        const boundsObj = {
            west: bounds.getWest(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            north: bounds.getNorth()
        };

        const button = document.getElementById('load-buildings');
        const originalText = button.textContent;
        button.textContent = '🔄 Loading buildings...';
        button.disabled = true;

        try {
            const response = await fetch('/api/load-osm-buildings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(boundsObj)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('OSM buildings loaded:', result);
                alert(`Loaded ${result.buildings_loaded} buildings from OpenStreetMap`);
                await this.loadFeatures();
            } else {
                const errorText = await response.text();
                console.error('Failed to load OSM buildings:', response.status, errorText);
                alert(`Failed to load buildings: ${response.status} - ${errorText}`);
            }
        } catch (error) {
            console.error('Error loading OSM buildings:', error);
            alert('Error loading buildings from OpenStreetMap');
        } finally {
            button.textContent = originalText;
            button.disabled = false;
        }
    }

    async loadOSMRoads() {
        const bounds = this.map.getBounds();
        const boundsObj = {
            west: bounds.getWest(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            north: bounds.getNorth()
        };

        const button = document.getElementById('load-roads');
        const originalText = button.textContent;
        button.textContent = '🔄 Loading roads...';
        button.disabled = true;

        try {
            const response = await fetch('/api/load-osm-roads', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(boundsObj)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('OSM roads loaded:', result);
                alert(`Loaded ${result.roads_loaded} roads from OpenStreetMap`);
                await this.loadFeatures();
            } else {
                const errorText = await response.text();
                console.error('Failed to load OSM roads:', response.status, errorText);
                alert(`Failed to load roads: ${response.status} - ${errorText}`);
            }
        } catch (error) {
            console.error('Error loading OSM roads:', error);
            alert('Error loading roads from OpenStreetMap');
        } finally {
            button.textContent = originalText;
            button.disabled = false;
        }
    }

    async loadOSMStreetlights() {
        const bounds = this.map.getBounds();
        const boundsObj = {
            west: bounds.getWest(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            north: bounds.getNorth()
        };

        const button = document.getElementById('load-streetlights');
        const originalText = button.textContent;
        button.textContent = '🔄 Loading street lights...';
        button.disabled = true;

        try {
            const response = await fetch('/api/load-osm-streetlights', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(boundsObj)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('OSM street lights loaded:', result);
                alert(`Loaded ${result.streetlights_loaded} street lights from OpenStreetMap`);
                await this.loadFeatures();
            } else {
                const errorText = await response.text();
                console.error('Failed to load OSM street lights:', response.status, errorText);
                alert(`Failed to load street lights: ${response.status} - ${errorText}`);
            }
        } catch (error) {
            console.error('Error loading OSM street lights:', error);
            alert('Error loading street lights from OpenStreetMap');
        } finally {
            button.textContent = originalText;
            button.disabled = false;
        }
    }

    async loadOSMTrafficLights() {
        const bounds = this.map.getBounds();
        const boundsObj = {
            west: bounds.getWest(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            north: bounds.getNorth()
        };

        const button = document.getElementById('load-traffic-lights');
        const originalText = button.textContent;
        button.textContent = '🔄 Loading traffic lights...';
        button.disabled = true;

        try {
            const response = await fetch('/api/load-osm-traffic-lights', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(boundsObj)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('OSM traffic lights loaded:', result);
                alert(`Loaded ${result.traffic_lights_loaded} traffic lights from OpenStreetMap`);
                await this.loadFeatures();
            } else {
                const errorText = await response.text();
                console.error('Failed to load OSM traffic lights:', response.status, errorText);
                alert(`Failed to load traffic lights: ${response.status} - ${errorText}`);
            }
        } catch (error) {
            console.error('Error loading OSM traffic lights:', error);
            alert('Error loading traffic lights from OpenStreetMap');
        } finally {
            button.textContent = originalText;
            button.disabled = false;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new MapEditor();
});