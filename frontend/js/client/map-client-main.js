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
}

// Initialize the vector client when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.mapClient = new MapClient();
});