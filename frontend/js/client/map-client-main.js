/**
 * Main Map Client Class
 * Orchestrates all client modules for vector-only viewing
 */

class MapClient {
    constructor() {
        // Initialize core components
        this.clientCore = new ClientCore();
        this.clientCore.initMap();
        
        // Initialize feature info display
        this.featureInfo = new FeatureInfo();
        
        // Initialize data loader
        this.dataLoader = new DataLoader(this.clientCore);
        
        // Load features
        this.loadFeatures();
        
        // Expose properties for backward compatibility
        this.map = this.clientCore.map;
        this.vectorSource = this.clientCore.vectorSource;
        this.vectorLayer = this.clientCore.vectorLayer;
        this.features = this.clientCore.features;
        this.selectedFeature = this.featureInfo.selectedFeature;
    }

    // Delegate methods for backward compatibility
    updateFeatureVisibility() {
        this.clientCore.updateFeatureVisibility();
    }

    loadFeatures() {
        return this.dataLoader.loadFeatures();
    }

    showFeatureInfo(feature) {
        this.featureInfo.showFeatureInfo(feature);
    }

    hideFeatureInfo() {
        this.featureInfo.hideFeatureInfo();
    }

    getUserLocation() {
        return this.clientCore.getUserLocation();
    }

    // Optional: Start auto-refresh of features
    startAutoRefresh(intervalMs = 30000) {
        this.dataLoader.startAutoRefresh(intervalMs);
    }
    
    /**
     * Update map styles when configuration changes
     */
    updateMapStyles(newStyles) {
        console.log('🎨 CLIENT: Updating map styles, re-evaluating all features...');
        
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
        console.log('🎨 CLIENT: Map styles updated and rendered');
    }
}

// Global function to update styles from the styles window
window.updateMapStyles = function(newStyles) {
    if (window.mapClient) {
        window.mapClient.updateMapStyles(newStyles);
    }
    if (window.mapEditor) {
        window.mapEditor.updateMapStyles(newStyles);
    }
};

// Initialize the vector client when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.mapClient = new MapClient();
});