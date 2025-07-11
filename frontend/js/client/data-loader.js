/**
 * Data Loader for Map Client
 * Handles loading features from backend (view-only)
 */

class DataLoader {
    constructor(clientCore) {
        this.clientCore = clientCore;
        this.apiService = new ApiService();
    }

    async loadFeatures() {
        try {
            const data = await this.apiService.getFeatures();
            this.clientCore.vectorSource.clear();
            this.clientCore.features.clear();

            for (const featureData of data.features) {
                if (featureData.geometry) {
                    const olFeature = GeometryUtils.geoJSONToOLFeature(featureData);

                    olFeature.setId(featureData.id);
                    olFeature.set('name', featureData.properties?.name || '');
                    olFeature.set('description', featureData.properties?.description || '');
                    olFeature.set('building_number', featureData.properties?.building_number || '');
                    olFeature.set('building_type', featureData.properties?.building_type || '');
                    olFeature.set('icon', featureData.properties?.icon || '');
                    olFeature.set('road_type', featureData.properties?.road_type || '');
                    olFeature.set('properties', featureData.properties || {});

                    this.clientCore.vectorSource.addFeature(olFeature);
                    this.clientCore.features.set(featureData.id, olFeature);
                }
            }

            // Update feature count display
            document.getElementById('feature-count').textContent = data.features.length;
            console.log(`Loaded ${data.features.length} vector features`);
            
            // Update visibility after loading
            this.clientCore.updateFeatureVisibility();
        } catch (error) {
            console.error('Error loading features:', error);
            document.getElementById('feature-count').textContent = 'Error';
        }
    }

    // Auto-refresh features every 30 seconds (optional)
    startAutoRefresh(intervalMs = 30000) {
        setInterval(() => {
            this.loadFeatures();
        }, intervalMs);
    }
}

// Export for use in modules
window.DataLoader = DataLoader;