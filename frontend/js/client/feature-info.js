/**
 * Feature Info Display for Map Client
 * Handles feature information display (view-only)
 */

class FeatureInfo {
    constructor() {
        this.selectedFeature = null;
    }

    showFeatureInfo(feature) {
        const properties = feature.get('properties') || {};
        const geometry = feature.getGeometry().getType();
        
        const title = feature.get('name') || properties.name || `${geometry} Feature`;
        const details = [];
        
        if (feature.get('description')) {
            details.push(`<strong>Description:</strong> ${feature.get('description')}`);
        }
        
        if (properties.feature_type) {
            details.push(`<strong>Type:</strong> ${properties.feature_type}`);
        }
        
        if (feature.get('building_type')) {
            details.push(`<strong>Building Type:</strong> ${feature.get('building_type')}`);
        }
        
        if (feature.get('road_type')) {
            details.push(`<strong>Road Type:</strong> ${feature.get('road_type')}`);
        }
        
        if (properties.osm_tags) {
            const tags = properties.osm_tags;
            if (tags['building:levels']) {
                details.push(`<strong>Levels:</strong> ${tags['building:levels']}`);
            }
            if (tags['addr:housenumber']) {
                details.push(`<strong>Address:</strong> ${tags['addr:housenumber']}`);
            }
            if (tags['maxspeed']) {
                details.push(`<strong>Speed Limit:</strong> ${tags['maxspeed']}`);
            }
            if (tags['lanes']) {
                details.push(`<strong>Lanes:</strong> ${tags['lanes']}`);
            }
        }
        
        details.push(`<strong>Geometry:</strong> ${geometry}`);
        
        if (properties.source) {
            details.push(`<strong>Source:</strong> ${properties.source}`);
        }
        
        document.getElementById('feature-title').textContent = title;
        document.getElementById('feature-details').innerHTML = details.join('<br>');
        document.getElementById('feature-info').style.display = 'block';
        
        this.selectedFeature = feature;
    }

    hideFeatureInfo() {
        document.getElementById('feature-info').style.display = 'none';
        this.selectedFeature = null;
    }
}

// Global function for closing feature info (called from HTML)
function hideFeatureInfo() {
    if (window.mapClient && window.mapClient.featureInfo) {
        window.mapClient.featureInfo.hideFeatureInfo();
    }
}

// Export for use in modules
window.FeatureInfo = FeatureInfo;