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
        // Select interaction
        this.select = new ol.interaction.Select({
            condition: ol.events.condition.click,
            style: (feature) => FeatureStyles.getSelectedFeatureStyle(feature),
            filter: () => true // Allow selection of all features
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
        const buttons = ['draw-point', 'draw-line', 'draw-polygon', 'select', 'delete'];
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
}

// Export for use in modules
window.DrawingTools = DrawingTools;