/**
 * Drawing Tools for Map Editor
 * Handles drawing interactions and tool management
 */

class DrawingTools {
    constructor(mapCore) {
        this.mapCore = mapCore;
        this.draw = null;
        this.modify = null;
        this.select = null;
        this.currentDrawType = null;
        this.editor = null;
        
        this.initInteractions();
    }

    setEditor(editor) {
        this.editor = editor;
    }

    initInteractions() {
        // Select interaction with custom selection logic
        this.select = new ol.interaction.Select({
            condition: ol.events.condition.never, // Disable default selection
            style: (feature) => FeatureStyles.getSelectedFeatureStyle(feature),
            filter: () => true
        });

        // Modify interaction with hidden control points
        this.modify = new ol.interaction.Modify({
            features: this.select.getFeatures(),
            style: () => FeatureStyles.getModifyStyle(),
            condition: (event) => {
                // Disable modification for point features
                const features = event.map.getFeaturesAtPixel(event.pixel);
                if (features && features.length > 0) {
                    const feature = features[0];
                    const geometry = feature.getGeometry();
                    if (geometry && geometry.getType() === 'Point') {
                        return false;
                    }
                }
                return true;
            }
        });

        // Add interactions to map
        this.mapCore.map.addInteraction(this.select);
        this.mapCore.map.addInteraction(this.modify);

        // Add custom click handler for smart selection
        this.mapCore.map.on('click', (event) => {
            this.handleSmartSelection(event);
        });

        // Handle feature selection
        this.select.on('select', (e) => {
            if (!this.editor) return;
            if (e.selected.length > 0) {
                this.editor.featureManager.selectFeature(e.selected[0]);
            } else {
                this.editor.featureManager.clearSelection();
            }
        });

        // Handle feature modification
        this.modify.on('modifyend', (e) => {
            if (!this.editor) return;
            e.features.forEach(feature => {
                this.editor.featureManager.updateFeatureFromOL(feature);
            });
        });
    }

    enableDrawing(geometryType) {
        this.disableDrawing();
        
        this.draw = new ol.interaction.Draw({
            source: this.mapCore.vectorSource,
            type: geometryType
        });

        this.mapCore.map.addInteraction(this.draw);
        this.currentDrawType = geometryType;

        this.draw.on('drawend', (e) => {
            const feature = e.feature;
            this.setupNewFeature(feature);
            if (this.editor) {
                this.editor.featureManager.selectFeature(feature);
            }
            this.disableDrawing();
        });
    }

    disableDrawing() {
        if (this.draw) {
            this.mapCore.map.removeInteraction(this.draw);
            this.draw = null;
            this.currentDrawType = null;
        }
        this.updateButtonStates();
    }

    setupNewFeature(feature) {
        // Generate temporary ID
        const tempId = GeometryUtils.generateTempId();
        feature.setId(tempId);
        
        // Set default properties
        feature.set('name', '');
        feature.set('description', '');
        feature.set('properties', {});
        feature.set('created_at', new Date().toISOString());
    }

    updateButtonStates() {
        const buttons = ['draw-point', 'draw-line', 'draw-polygon', 'select'];
        buttons.forEach(id => {
            const button = document.getElementById(id);
            button.disabled = !this.editor || !this.editor.editingEnabled;
            button.classList.remove('active');
        });

        if (this.currentDrawType) {
            const typeMap = {
                'Point': 'draw-point',
                'LineString': 'draw-line',
                'Polygon': 'draw-polygon'
            };
            const activeButton = document.getElementById(typeMap[this.currentDrawType]);
            if (activeButton) activeButton.classList.add('active');
        }
    }

    enableEditing() {
        this.select.setActive(true);
        this.modify.setActive(true);
        this.updateButtonStates();
    }

    disableEditing() {
        this.disableDrawing();
        if (this.editor) {
            this.editor.featureManager.clearSelection();
        }
        this.select.setActive(false);
        this.modify.setActive(false);
        this.updateButtonStates();
    }

    /**
     * Handle smart selection - prioritize smaller features over larger ones
     */
    handleSmartSelection(event) {
        // Get all features at the clicked pixel
        const allFeatures = this.mapCore.map.getFeaturesAtPixel(event.pixel);
        
        if (allFeatures.length === 0) {
            // No features, clear selection
            this.select.getFeatures().clear();
            if (this.editor) {
                this.editor.featureManager.clearSelection();
            }
            return;
        }
        
        if (allFeatures.length === 1) {
            // Only one feature, select it
            this.selectFeature(allFeatures[0]);
            return;
        }
        
        // Multiple features - prioritize smaller ones
        const sortedFeatures = allFeatures.sort((a, b) => {
            const areaA = this.calculateFeatureArea(a);
            const areaB = this.calculateFeatureArea(b);
            
            // Points always have highest priority
            if (a.getGeometry().getType() === 'Point' && b.getGeometry().getType() !== 'Point') {
                return -1;
            }
            if (b.getGeometry().getType() === 'Point' && a.getGeometry().getType() !== 'Point') {
                return 1;
            }
            
            // Lines have higher priority than polygons
            if (a.getGeometry().getType() === 'LineString' && b.getGeometry().getType() === 'Polygon') {
                return -1;
            }
            if (b.getGeometry().getType() === 'LineString' && a.getGeometry().getType() === 'Polygon') {
                return 1;
            }
            
            // For same geometry types, prefer smaller area
            return areaA - areaB;
        });
        
        // Select the highest priority (smallest) feature
        this.selectFeature(sortedFeatures[0]);
        
        console.log(`🎯 Smart selection: Selected "${sortedFeatures[0].get('name') || 'Unnamed'}" from ${allFeatures.length} features`);
    }

    /**
     * Calculate feature area for selection prioritization
     */
    calculateFeatureArea(feature) {
        const geometry = feature.getGeometry();
        const geometryType = geometry.getType();
        
        if (geometryType === 'Point') {
            return 0; // Points have no area
        }
        
        if (geometryType === 'LineString') {
            return 0.0001; // Small area for lines
        }
        
        if (geometryType === 'Polygon') {
            const extent = geometry.getExtent();
            const width = extent[2] - extent[0];
            const height = extent[3] - extent[1];
            return width * height;
        }
        
        return 1; // Default for other geometry types
    }

    /**
     * Select a specific feature
     */
    selectFeature(feature) {
        this.select.getFeatures().clear();
        this.select.getFeatures().push(feature);
        
        if (this.editor) {
            this.editor.featureManager.selectFeature(feature);
        }
    }
}

// Export for use in modules
window.DrawingTools = DrawingTools;