/**
 * Feature Manager for Map Editor
 * Handles feature operations, selection, and data management
 */

class FeatureManager {
    constructor(mapCore) {
        this.mapCore = mapCore;
        this.selectedFeature = null;
        this.apiService = new ApiService();
        this.editor = null;
    }

    setEditor(editor) {
        this.editor = editor;
    }

    selectFeature(feature) {
        this.selectedFeature = feature;
        this.showFeatureInfo(feature);
        
        // Clear existing selection and select this feature
        if (this.editor) {
            this.editor.drawingTools.select.getFeatures().clear();
            this.editor.drawingTools.select.getFeatures().push(feature);
        }
    }

    clearSelection() {
        this.selectedFeature = null;
        this.hideFeatureInfo();
        if (this.editor) {
            this.editor.drawingTools.select.getFeatures().clear();
        }
    }

    showFeatureInfo(feature) {
        const infoPanel = document.getElementById('feature-info');
        const properties = feature.get('properties') || {};
        
        document.getElementById('feature-name').value = feature.get('name') || '';
        document.getElementById('feature-description').value = feature.get('description') || '';
        document.getElementById('building-number').value = feature.get('building_number') || properties.building_number || '';
        document.getElementById('building-type').value = feature.get('building_type') || properties.building_type || '';
        document.getElementById('building-icon').value = feature.get('icon') || properties.icon || '';
        
        infoPanel.style.display = 'block';
    }

    hideFeatureInfo() {
        document.getElementById('feature-info').style.display = 'none';
    }

    updateFeatureFromOL(feature) {
        // Convert OpenLayers geometry to GeoJSON
        const geometry = feature.getGeometry();
        const geojsonGeometry = GeometryUtils.olGeometryToGeoJSON(geometry);
        feature.set('geometry_json', geojsonGeometry);
    }

    deleteSelectedFeature() {
        if (!this.selectedFeature || !this.editor || !this.editor.editingEnabled) return;

        const featureId = this.selectedFeature.getId();
        
        // Remove from vector source
        this.mapCore.vectorSource.removeFeature(this.selectedFeature);
        
        // Remove from features map
        if (featureId && !GeometryUtils.isTempId(featureId)) {
            this.mapCore.features.delete(featureId);
            this.deleteFeatureFromBackend(featureId);
        }
        
        this.clearSelection();
    }

    clearAllFeatures() {
        if (!confirm('Are you sure you want to clear all features? This will delete them from the database permanently.')) return;
        
        this.apiService.clearAllFeatures()
            .then(() => {
                // Clear from map and local storage
                this.mapCore.vectorSource.clear();
                this.mapCore.features.clear();
                this.clearSelection();
                console.log('All features cleared successfully');
            })
            .catch(error => {
                console.error('Error clearing features:', error);
                alert(`Error clearing features: ${error.message}`);
            });
    }

    saveCurrentFeature() {
        if (!this.selectedFeature) return;

        // Get form values
        const name = document.getElementById('feature-name').value;
        const description = document.getElementById('feature-description').value;
        const buildingNumber = document.getElementById('building-number').value;
        const buildingType = document.getElementById('building-type').value;
        const icon = document.getElementById('building-icon').value;

        // Update feature properties
        this.selectedFeature.set('name', name);
        this.selectedFeature.set('description', description);
        this.selectedFeature.set('building_number', buildingNumber);
        this.selectedFeature.set('building_type', buildingType);
        this.selectedFeature.set('icon', icon);

        // Update geometry
        this.updateFeatureFromOL(this.selectedFeature);

        // Save to backend
        this.saveFeatureToBackend(this.selectedFeature);
        
        this.clearSelection();
    }

    async saveFeatureToBackend(feature) {
        try {
            const geometry = feature.get('geometry_json');
            if (!geometry) {
                this.updateFeatureFromOL(feature);
            }

            const featureData = {
                name: feature.get('name') || '',
                description: feature.get('description') || '',
                geometry: feature.get('geometry_json'),
                properties: feature.get('properties') || {},
                building_number: feature.get('building_number') || '',
                building_type: feature.get('building_type') || '',
                icon: feature.get('icon') || ''
            };

            const featureId = feature.getId();
            let result;

            if (featureId && !GeometryUtils.isTempId(featureId)) {
                // Update existing feature
                result = await this.apiService.updateFeature(featureId, featureData);
            } else {
                // Create new feature
                result = await this.apiService.createFeature(featureData);
            }

            feature.setId(result.id);
            this.mapCore.features.set(result.id, feature);
            console.log('Feature saved successfully');
        } catch (error) {
            console.error('Error saving feature:', error);
            alert(`Error saving feature: ${error.message}`);
        }
    }

    async deleteFeatureFromBackend(featureId) {
        try {
            await this.apiService.deleteFeature(featureId);
            console.log('Feature deleted successfully');
        } catch (error) {
            console.error('Error deleting feature:', error);
            alert(`Error deleting feature: ${error.message}`);
        }
    }

    async saveAllFeatures() {
        const features = this.mapCore.vectorSource.getFeatures();
        if (features.length === 0) {
            alert('No features to save');
            return;
        }

        let saved = 0;
        let errors = 0;

        for (const feature of features) {
            try {
                await this.saveFeatureToBackend(feature);
                saved++;
            } catch (error) {
                errors++;
                console.error('Error saving feature:', error);
            }
        }

        alert(`Saved ${saved} features. ${errors} errors.`);
    }

    async loadFeatures() {
        try {
            const data = await this.apiService.getFeatures();
            this.mapCore.vectorSource.clear();
            this.mapCore.features.clear();

            for (const featureData of data.features) {
                if (featureData.geometry) {
                    const olFeature = GeometryUtils.geoJSONToOLFeature(featureData);

                    olFeature.setId(featureData.id);
                    olFeature.set('name', featureData.properties?.name || '');
                    olFeature.set('description', featureData.properties?.description || '');
                    olFeature.set('building_number', featureData.properties?.building_number || '');
                    olFeature.set('building_type', featureData.properties?.building_type || '');
                    olFeature.set('icon', featureData.properties?.icon || '');
                    olFeature.set('properties', featureData.properties || {});

                    this.mapCore.vectorSource.addFeature(olFeature);
                    this.mapCore.features.set(featureData.id, olFeature);
                }
            }

            console.log(`Loaded ${data.features.length} features`);
        } catch (error) {
            console.error('Error loading features:', error);
            alert(`Error loading features: ${error.message}`);
        }
    }

    async loadOSMData(type) {
        const bounds = GeometryUtils.getMapBounds(this.mapCore.map);
        
        try {
            const result = await this.apiService.loadOSMData(type, bounds);
            alert(result.message);
            this.loadFeatures(); // Reload to show new features
        } catch (error) {
            console.error(`Error loading ${type}:`, error);
            alert(`Error loading ${type}: ${error.message}`);
        }
    }
}

// Export for use in modules
window.FeatureManager = FeatureManager;