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
        this.controls.setEditor(this);
        
        // Load existing features using simple bulk loading
        this.featureManager.loadFeatures();
        
        // Refresh all feature styles to apply z-index ordering
        setTimeout(() => {
            this.refreshAllFeatureStyles();
        }, 1000);
        
        console.log('🚀 Map editor initialized with simple feature loading');
        
        // Expose properties for backward compatibility
        this.map = this.mapCore.map;
        this.vectorSource = this.mapCore.vectorSource;
        this.vectorLayer = this.mapCore.vectorLayer;
        this.features = this.mapCore.features;
        this.editingEnabled = false; // Will be synced automatically
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
    }

    toggle3D() {
        this.controls.toggle3D();
    }
    
    /**
     * Update map styles when configuration changes
     */
    updateMapStyles(newStyles) {
        console.log('🎨 Updating map styles, re-evaluating all features...');
        
        // Force refresh all feature styles AND visibility
        const currentZoom = this.map.getView().getZoom();
        this.vectorSource.getFeatures().forEach(feature => {
            // Re-evaluate visibility
            if (FEATURE_VISIBILITY.shouldShowFeature(feature, currentZoom)) {
                feature.setStyle(FeatureStyles.getFeatureStyle(feature));
            } else {
                // Hide feature by setting null style
                feature.setStyle(null);
            }
        });
        
        // Trigger map re-render
        this.map.render();
        console.log('🎨 Map styles updated and rendered');
    }

    /**
     * Refresh all feature styles (useful after z-index changes)
     */
    refreshAllFeatureStyles() {
        console.log('🔄 Refreshing all feature styles with new z-index...');
        
        this.vectorSource.getFeatures().forEach(feature => {
            feature.setStyle(FeatureStyles.getFeatureStyle(feature));
        });
        
        // Trigger map re-render
        this.map.render();
        console.log('✅ All feature styles refreshed');
    }
}

// Global function to update styles from the styles window
window.updateMapStyles = function(newStyles) {
    if (window.mapEditor) {
        window.mapEditor.updateMapStyles(newStyles);
    }
};

// Initialize the map editor when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.mapEditor = new MapEditor();
});