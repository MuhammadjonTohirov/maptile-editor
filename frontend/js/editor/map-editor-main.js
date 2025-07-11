/**
 * Main Map Editor Class
 * Orchestrates all editor modules
 */

class MapEditor {
    constructor() {
        // Initialize core components
        this.mapCore = new MapCore();
        this.mapCore.initMap();
        
        // Initialize drawing tools
        this.drawingTools = new DrawingTools(this.mapCore);
        
        // Initialize feature manager
        this.featureManager = new FeatureManager(this.mapCore);
        
        // Initialize controls
        this.controls = new Controls(this.mapCore, this.drawingTools, this.featureManager);
        
        // Set up cross-references
        this.mapCore.setEditor(this);
        this.drawingTools.setEditor(this);
        this.featureManager.setEditor(this);
        
        // Load existing features
        this.featureManager.loadFeatures();
        
        // Expose properties for backward compatibility
        this.map = this.mapCore.map;
        this.vectorSource = this.mapCore.vectorSource;
        this.vectorLayer = this.mapCore.vectorLayer;
        this.features = this.mapCore.features;
        this.editingEnabled = this.controls.editingEnabled;
        this.currentDrawType = this.drawingTools.currentDrawType;
    }

    // Delegate methods for backward compatibility
    updateFeatureVisibility() {
        this.mapCore.updateFeatureVisibility();
    }

    getUserLocation() {
        return this.mapCore.getUserLocation();
    }

    enableDrawing(type) {
        this.drawingTools.enableDrawing(type);
    }

    disableDrawing() {
        this.drawingTools.disableDrawing();
    }

    selectFeature(feature) {
        this.featureManager.selectFeature(feature);
    }

    clearSelection() {
        this.featureManager.clearSelection();
    }

    saveCurrentFeature() {
        this.featureManager.saveCurrentFeature();
    }

    deleteSelectedFeature() {
        this.featureManager.deleteSelectedFeature();
    }

    clearAllFeatures() {
        this.featureManager.clearAllFeatures();
    }

    saveAllFeatures() {
        return this.featureManager.saveAllFeatures();
    }

    loadFeatures() {
        return this.featureManager.loadFeatures();
    }

    loadOSMData(type) {
        return this.featureManager.loadOSMData(type);
    }

    toggleEditing() {
        this.controls.toggleEditing();
        this.editingEnabled = this.controls.editingEnabled;
    }

    toggle3D() {
        this.controls.toggle3D();
    }
}

// Initialize the map editor when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.mapEditor = new MapEditor();
});