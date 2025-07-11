/**
 * Feature Styling Utilities
 * Shared styling logic for map features
 */

class FeatureStyles {
    /**
     * Get style for a feature based on its properties
     */
    static getFeatureStyle(feature) {
        const geometry = feature.getGeometry();
        const geometryType = geometry.getType();
        const properties = feature.get('properties') || {};
        
        let fillColor = 'rgba(255, 255, 255, 0.2)';
        let strokeColor = '#3399CC';
        let strokeWidth = 2;
        let pointRadius = 8;
        let pointColor = '#3399CC';

        // Style based on geometry type
        switch (geometryType) {
            case 'Point':
                pointColor = '#ff6b35';
                pointRadius = 6;
                break;
            case 'LineString':
                strokeColor = '#ff6b35';
                strokeWidth = 3;
                break;
            case 'Polygon':
                fillColor = 'rgba(255, 107, 53, 0.2)';
                strokeColor = '#ff6b35';
                break;
        }

        // Override colors based on feature type
        if (properties.feature_type === MAP_CONSTANTS.FEATURE_TYPES.ROAD) {
            strokeColor = '#555555';
            strokeWidth = 4;
        } else if (properties.building_type) {
            fillColor = 'rgba(138, 43, 226, 0.3)';
            strokeColor = '#8a2be2';
        } else if (properties.feature_type === MAP_CONSTANTS.FEATURE_TYPES.STREETLIGHT) {
            pointColor = '#ffeb3b';
        } else if (properties.feature_type === MAP_CONSTANTS.FEATURE_TYPES.TRAFFIC_LIGHT) {
            pointColor = '#f44336';
        }

        const style = new ol.style.Style({
            fill: new ol.style.Fill({
                color: fillColor
            }),
            stroke: new ol.style.Stroke({
                color: strokeColor,
                width: strokeWidth
            }),
            image: geometryType === 'Point' ? new ol.style.Circle({
                radius: pointRadius,
                fill: new ol.style.Fill({
                    color: pointColor
                }),
                stroke: new ol.style.Stroke({
                    color: '#ffffff',
                    width: 2
                })
            }) : undefined
        });

        // Add text label for named features (except roads and points)
        const name = feature.get('name') || properties.name;
        if (name && geometryType !== 'Point' && properties.feature_type !== MAP_CONSTANTS.FEATURE_TYPES.ROAD) {
            style.setText(new ol.style.Text({
                text: name,
                font: '12px Arial',
                fill: new ol.style.Fill({
                    color: '#000000'
                }),
                stroke: new ol.style.Stroke({
                    color: '#ffffff',
                    width: 2
                })
            }));
        }

        // Add icon for point features (except turning_point)
        if (geometryType === 'Point' && properties.icon && 
            properties.feature_type !== MAP_CONSTANTS.FEATURE_TYPES.TURNING_POINT) {
            style.setText(new ol.style.Text({
                text: properties.icon,
                font: '20px Arial',
                offsetY: -pointRadius - 10
            }));
        }

        return style;
    }

    /**
     * Get selected feature style (highlighted)
     */
    static getSelectedFeatureStyle(feature) {
        const geometry = feature.getGeometry();
        const geometryType = geometry.getType();
        
        // For points, use a simple highlighted circle
        if (geometryType === 'Point') {
            const properties = feature.get('properties') || {};
            return new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 10,
                    fill: new ol.style.Fill({
                        color: '#ffff00'
                    }),
                    stroke: new ol.style.Stroke({
                        color: '#ff6b35',
                        width: 3
                    })
                }),
                text: (properties.icon && properties.feature_type !== MAP_CONSTANTS.FEATURE_TYPES.TURNING_POINT) ? 
                    new ol.style.Text({
                        text: properties.icon,
                        font: '20px Arial',
                        offsetY: -15
                    }) : undefined
            });
        }
        
        // For other geometries, use modified original style
        const style = FeatureStyles.getFeatureStyle(feature);
        if (style.getStroke()) {
            style.getStroke().setColor('#ffff00');
            style.getStroke().setWidth(style.getStroke().getWidth() + 1);
        }
        if (style.getFill()) {
            style.getFill().setColor('rgba(255, 255, 0, 0.3)');
        }
        return style;
    }

    /**
     * Get style without icon (for turning_point features)
     */
    static getFeatureStyleWithoutIcon(feature) {
        const style = FeatureStyles.getFeatureStyle(feature);
        if (style && style.getText) {
            style.setText(null);
        }
        return style;
    }

    /**
     * Get modify style (hidden for clean appearance)
     */
    static getModifyStyle() {
        return null; // Hide modification handles
    }
}

// Export for use in modules
window.FeatureStyles = FeatureStyles;