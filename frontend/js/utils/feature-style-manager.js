/**
 * Feature Style Manager
 * Modular approach to feature styling with separate concerns
 */

class FeatureStyleManager {
    constructor() {
        this.styles = this.getConfiguredStyles();
        this.collisionManager = new LabelCollisionManager();
        this.frameStarted = false;
    }

    /**
     * Get configured styles from localStorage or defaults
     */
    getConfiguredStyles() {
        const defaultStyles = {
            point: { color: '#3399CC', radius: 8, borderColor: '#ffffff', borderWidth: 2 },
            line: { color: '#ff6b35', width: 3 },
            polygon: { fillColor: '#ff6b35', fillOpacity: 0.2, borderColor: '#ff6b35', borderWidth: 2 },
            road: { color: '#555555', width: 4, serviceRoadMinZoom: 15 },
            footway: { color: '#8B4513', width: 2, minZoom: 16, enabled: true }, // Brown color for footways
            minorRoad: { color: '#999999', width: 1.5 }, // Gray for minor roads (steps, path, cycleway, etc.)
            serviceRoad: { color: '#CCCCCC', width: 1 }, // Light gray for service roads
            building: { fillColor: '#8a2be2', fillOpacity: 0.3, borderColor: '#8a2be2' },
            landuse: { fillColor: '#98D982', fillOpacity: 0.4, borderColor: '#7CB668' },
            natural: { fillColor: '#A8CC8C', fillOpacity: 0.4, borderColor: '#88B86C' },
            leisure: { fillColor: '#4CAF50', fillOpacity: 0.3, borderColor: '#45A049' },
            amenity: { fillColor: '#FF9800', fillOpacity: 0.4, borderColor: '#F57C00' },
            transportation: { fillColor: '#9E9E9E', fillOpacity: 0.5, borderColor: '#757575' },
            water: { fillColor: '#2196F3', fillOpacity: 0.6, borderColor: '#1976D2' },
            sport: { fillColor: '#FFC107', fillOpacity: 0.4, borderColor: '#FFA000' },
            utility: { fillColor: '#E91E63', fillOpacity: 0.4, borderColor: '#C2185B' },
            streetlight: { color: '#ffeb3b' },
            trafficLight: { color: '#f44336' },
            streetLabel: {
                fontSize: 12,
                color: '#000000',
                outlineColor: '#ffffff',
                outlineWidth: 2,
                repeat: 300,
                enabled: true,
                minZoom: 14,
                performance: 'balanced'
            },
            polygonLabel: {
                fontSize: 14,
                color: '#000000',
                outlineColor: '#ffffff',
                outlineWidth: 2,
                minZoom: 14,
                iconEnabled: true,
                iconSize: 20,
                minPolygonArea: 0.000001, // Minimum polygon area to show labels
                minScale: 0.3, // Minimum text scale for small polygons
                maxScale: 2.0, // Maximum text scale for large polygons
                paddingFactor: 0.8 // How much of polygon to use for text (0.8 = 80%)
            }
        };
        
        try {
            const stored = localStorage.getItem('mapStyles');
            if (stored) {
                const parsedStyles = JSON.parse(stored);
                const mergedStyles = { ...defaultStyles, ...parsedStyles };
                
                // Ensure required nested objects exist
                if (!mergedStyles.streetLabel) {
                    mergedStyles.streetLabel = defaultStyles.streetLabel;
                } else {
                    mergedStyles.streetLabel = { ...defaultStyles.streetLabel, ...mergedStyles.streetLabel };
                }
                
                if (!mergedStyles.polygonLabel) {
                    mergedStyles.polygonLabel = defaultStyles.polygonLabel;
                } else {
                    mergedStyles.polygonLabel = { ...defaultStyles.polygonLabel, ...mergedStyles.polygonLabel };
                }
                
                console.log('Loaded polygon label config:', mergedStyles.polygonLabel);
                return mergedStyles;
            }
        } catch (e) {
            console.error('Error loading stored styles:', e);
        }
        
        return defaultStyles;
    }

    /**
     * Get style for a feature
     */
    getFeatureStyle(feature) {
        // Start new collision frame if this is the first feature
        if (!this.frameStarted) {
            this.collisionManager.clearFrame();
            this.frameStarted = true;
            
            // Reset frame flag after a short delay
            setTimeout(() => {
                this.frameStarted = false;
            }, 50);
        }
        
        const geometry = feature.getGeometry();
        const geometryType = geometry.getType();
        const properties = feature.get('properties') || {};
        
        // Get base style based on geometry and feature type
        const baseStyle = this.getBaseStyle(feature, geometryType, properties);
        
        // Add text labels if applicable (with collision detection)
        this.addTextLabels(baseStyle, feature, geometryType, properties);
        
        // Add icons for point features
        this.addPointIcons(baseStyle, feature, geometryType, properties);
        
        return baseStyle;
    }

    /**
     * Get base OpenLayers style object
     */
    getBaseStyle(feature, geometryType, properties) {
        const styleConfig = this.getStyleConfig(geometryType, properties);
        
        return new ol.style.Style({
            fill: new ol.style.Fill({
                color: styleConfig.fillColor
            }),
            stroke: new ol.style.Stroke({
                color: styleConfig.strokeColor,
                width: styleConfig.strokeWidth
            }),
            image: geometryType === 'Point' ? new ol.style.Circle({
                radius: styleConfig.pointRadius,
                fill: new ol.style.Fill({
                    color: styleConfig.pointColor
                }),
                stroke: new ol.style.Stroke({
                    color: styleConfig.pointBorderColor,
                    width: styleConfig.pointBorderWidth
                })
            }) : undefined,
            zIndex: this.calculateZIndex(feature, geometryType)
        });
    }

    /**
     * Calculate z-index based on feature size and type
     * Larger features get lower z-index (appear behind smaller features)
     */
    calculateZIndex(feature, geometryType) {
        const baseZIndex = {
            'Point': 1000,      // Points always on top
            'LineString': 500,   // Lines in middle
            'Polygon': 100       // Polygons at bottom
        };
        
        let zIndex = baseZIndex[geometryType] || 100;
        
        // For polygons, calculate area-based z-index
        if (geometryType === 'Polygon') {
            const geometry = feature.getGeometry();
            const extent = geometry.getExtent();
            
            // Calculate area in map units
            const width = extent[2] - extent[0];
            const height = extent[3] - extent[1];
            const area = width * height;
            
            // Convert area to a z-index modifier
            // Larger areas get lower z-index (negative modifier)
            // Smaller areas get higher z-index (positive modifier)
            const areaModifier = Math.max(-50, Math.min(50, -Math.log10(area + 0.000001) * 10));
            
            zIndex = baseZIndex[geometryType] + Math.round(areaModifier);
            
            // Ensure minimum z-index for very large features
            zIndex = Math.max(10, zIndex);
            
            // Debug logging
            const featureName = feature.get('name') || 'Unnamed';
            console.log(`🎯 Z-Index: ${featureName} (area: ${area.toExponential(2)}) -> z-index: ${zIndex}`);
        }
        
        return zIndex;
    }

    /**
     * Determine style configuration based on feature type and geometry
     */
    getStyleConfig(geometryType, properties) {
        let config = {
            fillColor: 'rgba(255, 255, 255, 0.2)',
            strokeColor: this.styles.point.color,
            strokeWidth: this.styles.polygon.borderWidth,
            pointRadius: this.styles.point.radius,
            pointColor: this.styles.point.color,
            pointBorderColor: this.styles.point.borderColor,
            pointBorderWidth: this.styles.point.borderWidth
        };

        // Apply geometry-based defaults
        switch (geometryType) {
            case 'Point':
                config.pointColor = this.styles.point.color;
                config.pointRadius = this.styles.point.radius;
                break;
            case 'LineString':
                config.strokeColor = this.styles.line.color;
                config.strokeWidth = this.styles.line.width;
                break;
            case 'Polygon':
                config.fillColor = `rgba(${this.hexToRgb(this.styles.polygon.fillColor)}, ${this.styles.polygon.fillOpacity})`;
                config.strokeColor = this.styles.polygon.borderColor;
                config.strokeWidth = this.styles.polygon.borderWidth;
                break;
        }

        // Apply feature-type specific overrides
        this.applyFeatureTypeOverrides(config, properties);

        return config;
    }

    /**
     * Apply feature-type specific style overrides
     */
    applyFeatureTypeOverrides(config, properties) {
        const roadType = properties.road_type || properties.osm_tags?.highway;
        
        if (properties.feature_type === MAP_CONSTANTS.FEATURE_TYPES.ROAD || roadType) {
            // Check for specific road types first
            if (roadType === 'footway') {
                config.strokeColor = this.styles.footway?.color || '#8B4513'; // Brown color for footways
                config.strokeWidth = this.styles.footway?.width || 2; // Thinner width for footways
            } else if (MAP_CONSTANTS.MINOR_ROAD_TYPES.includes(roadType)) {
                config.strokeColor = this.styles.minorRoad?.color || '#999999'; // Gray for minor roads
                config.strokeWidth = this.styles.minorRoad?.width || 1.5;
            } else if (MAP_CONSTANTS.SERVICE_ROAD_TYPES.includes(roadType)) {
                config.strokeColor = this.styles.serviceRoad?.color || '#CCCCCC'; // Light gray for service roads
                config.strokeWidth = this.styles.serviceRoad?.width || 1;
            } else {
                // Default road styling
                config.strokeColor = this.styles.road.color;
                config.strokeWidth = this.styles.road.width;
            }
        } else if (properties.building_type || properties.polygon_category === 'building') {
            config.fillColor = `rgba(${this.hexToRgb(this.styles.building.fillColor)}, ${this.styles.building.fillOpacity})`;
            config.strokeColor = this.styles.building.borderColor;
        } else if (properties.polygon_category) {
            // Handle different polygon categories
            const category = properties.polygon_category;
            const categoryStyle = this.styles[category];
            if (categoryStyle) {
                config.fillColor = `rgba(${this.hexToRgb(categoryStyle.fillColor)}, ${categoryStyle.fillOpacity})`;
                config.strokeColor = categoryStyle.borderColor;
            }
        } else if (properties.feature_type === MAP_CONSTANTS.FEATURE_TYPES.STREETLIGHT) {
            config.pointColor = this.styles.streetlight.color;
        } else if (properties.feature_type === MAP_CONSTANTS.FEATURE_TYPES.TRAFFIC_LIGHT) {
            config.pointColor = this.styles.trafficLight.color;
        }
    }

    /**
     * Add text labels to style if applicable
     */
    addTextLabels(style, feature, geometryType, properties) {
        // Get feature name from multiple sources
        let name = feature.get('name') || properties.name || feature.get('title');
        
        // For user-created features, also check building number
        const buildingNumber = feature.get('building_number') || properties.building_number;
        if (buildingNumber && !name) {
            name = buildingNumber;
        } else if (buildingNumber && name) {
            // name = `${buildingNumber} - ${name}`;
            name = `${buildingNumber}`;
        }

        if (!name || geometryType === 'Point') return;

        // Get current zoom from either editor or client context
        const currentZoom = window.mapEditor?.map?.getView()?.getZoom() || 
                           window.mapClient?.map?.getView()?.getZoom() || 15;

        if (geometryType === 'LineString') {
            this.addStreetLabels(style, name, currentZoom);
        } else {
            this.addPolygonLabels(style, name, currentZoom, properties, feature);
        }
    }

    /**
     * Add street labels for LineString features
     */
    addStreetLabels(style, name, currentZoom) {
        if (!this.styles.streetLabel || !this.styles.streetLabel.enabled) return;

        const minZoomForLabels = this.styles.streetLabel.minZoom || 14;
        
        if (currentZoom < minZoomForLabels) {return;}

        // Adjust repeat distance based on zoom and performance mode
        const performanceMode = this.styles.streetLabel.performance || 'balanced';
        let repeatMultiplier = 1.5; // default balanced

        switch (performanceMode) {
            case 'smooth':
                repeatMultiplier = 3;
                break;
            case 'detailed':
                repeatMultiplier = 0.7;
                break;
        }

        const baseRepeat = this.styles.streetLabel.repeat * repeatMultiplier;
        const repeatDistance = currentZoom < 16 ? baseRepeat * 1.5 : baseRepeat;

        // if name contains muhammad
        style.setText(new ol.style.Text({
            text: name,
            font: `${this.styles.streetLabel.fontSize}px Arial`,
            fill: new ol.style.Fill({
                color: this.styles.streetLabel.color
            }),
            stroke: new ol.style.Stroke({
                color: this.styles.streetLabel.outlineColor,
                width: this.styles.streetLabel.outlineWidth
            }),
            placement: 'line',
            repeat: repeatDistance,
            overflow: false,
            maxAngle: Math.PI / 4
        }));
    }

    /**
     * Add polygon labels with optional icons
     */
    addPolygonLabels(style, name, currentZoom, properties, feature) {
        if (!this.styles.polygonLabel) return;

        // CONVENTIONAL MAP APPROACH - like Google Maps/Yandex
        
        // 1. Zoom-based visibility (buildings appear at higher zoom levels)
        const minZoomForBuildings = 16;
        if (currentZoom < minZoomForBuildings) return;
        
        // 2. Building hierarchy - prioritize larger buildings at lower zoom
        const geometry = feature.getGeometry();
        const extent = geometry.getExtent();
        const buildingArea = (extent[2] - extent[0]) * (extent[3] - extent[1]);
        
        // Show larger buildings first
        const minAreaForZoom = this.getBuildingMinAreaForZoom(currentZoom);
        if (buildingArea < minAreaForZoom) return;
        
        // 3. Prepare display text
        const polygonIcon = properties.icon;
        let displayText = name;
        if (polygonIcon && this.styles.polygonLabel.iconEnabled) {
            displayText = `${polygonIcon} ${name}`;
        }
        
        // 4. Zoom-based text sizing (like real maps)
        const fontSize = this.getMapStyleFontSize(currentZoom);
        
        // 5. Simple collision detection
        if (this.shouldHideLabelForCollision(feature, currentZoom)) {
            console.log(`🚫 Hiding "${displayText}" - collision avoidance`);
            return;
        }
        
        console.log(`🗺️ MAP-STYLE label: "${displayText}" at zoom ${currentZoom}, size ${fontSize}px`);
        
        // 6. Standard map styling
        style.setText(new ol.style.Text({
            text: displayText,
            font: `bold ${fontSize}px Arial`,
            fill: new ol.style.Fill({
                color: '#000000' // Black text like real maps
            }),
            stroke: new ol.style.Stroke({
                color: '#FFFFFF', // White outline like real maps
                width: 2
            }),
            textAlign: 'center',
            textBaseline: 'middle',
            overflow: false, // Don't show if too crowded
            placement: 'point'
        }));
    }

    /**
     * Get minimum building area to show at current zoom (like real maps)
     */
    getBuildingMinAreaForZoom(zoom) {
        // Real maps show larger buildings first, then smaller ones at higher zoom
        if (zoom >= 19) return 0.00000001; // Show all buildings at max zoom
        if (zoom >= 18) return 0.0000001;  // Show medium+ buildings  
        if (zoom >= 17) return 0.000001;   // Show large buildings
        if (zoom >= 16) return 0.00001;    // Show only very large buildings
        return 0.0001; // Below zoom 16, only massive buildings
    }
    
    /**
     * Get font size based on zoom level (like real maps)
     */
    getMapStyleFontSize(zoom) {
        // Font size increases with zoom like real maps
        const baseSize = 10;
        const zoomFactor = Math.max(0, zoom - 15); // Start scaling from zoom 15
        return Math.min(18, baseSize + zoomFactor * 1.5); // Cap at 18px
    }
    
    /**
     * Simple collision detection for map-style labels
     */
    shouldHideLabelForCollision(feature, zoom) {
        const map = window.mapEditor?.map || window.mapClient?.map;
        if (!map || !this.collisionManager) return false;
        
        const geometry = feature.getGeometry();
        const extent = geometry.getExtent();
        const center = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
        const centerScreen = map.getPixelFromCoordinate(center);
        
        if (!centerScreen) return false;
        
        // Simple distance-based collision (like real maps)
        const minDistance = Math.max(40, 80 - zoom * 2); // Closer spacing at higher zoom
        
        for (const [_, bounds] of this.collisionManager.labelBounds) {
            const existingCenter = {
                x: (bounds.left + bounds.right) / 2,
                y: (bounds.top + bounds.bottom) / 2
            };
            
            const distance = Math.sqrt(
                Math.pow(centerScreen.x - existingCenter.x, 2) + 
                Math.pow(centerScreen.y - existingCenter.y, 2)
            );
            
            if (distance < minDistance) {
                return true; // Hide due to collision
            }
        }
        
        // Register this label
        this.collisionManager.registerLabel(feature.getId() || feature.ol_uid, {
            left: centerScreen.x - 30,
            right: centerScreen.x + 30,
            top: centerScreen.y - 10,
            bottom: centerScreen.y + 10
        }, 1);
        
        return false; // No collision, show label
    }

    /**
     * Calculate text scale based on polygon size to fit text within polygon
     */
    calculateTextScale(feature, text, currentZoom) {
        const geometry = feature.getGeometry();
        const extent = geometry.getExtent();
        
        // Get polygon dimensions in map units
        const polygonWidth = extent[2] - extent[0];
        const polygonHeight = extent[3] - extent[1];
        
        // Convert to screen pixels (approximate)
        const map = window.mapEditor?.map || window.mapClient?.map;
        if (!map) return 1.0;
        
        const view = map.getView();
        const resolution = view.getResolution();
        const pixelsPerMapUnit = 1 / resolution;
        
        const polygonWidthPx = polygonWidth * pixelsPerMapUnit;
        const polygonHeightPx = polygonHeight * pixelsPerMapUnit;
        
        // Estimate text dimensions
        const fontSize = this.styles.polygonLabel.fontSize;
        const lines = text.split('\n');
        const maxLineLength = Math.max(...lines.map(line => line.length));
        
        // Approximate character width and line height in pixels
        const charWidthPx = fontSize * 0.6; // Rough approximation
        const lineHeightPx = fontSize * 1.2;
        
        const textWidthPx = maxLineLength * charWidthPx;
        const textHeightPx = lines.length * lineHeightPx;
        
        // Calculate scale needed to fit text in polygon (with configurable padding)
        const paddingFactor = this.styles.polygonLabel.paddingFactor || 0.8;
        const scaleX = (polygonWidthPx * paddingFactor) / textWidthPx;
        const scaleY = (polygonHeightPx * paddingFactor) / textHeightPx;
        
        // Use the smaller scale to ensure text fits in both dimensions
        const requiredScale = Math.min(scaleX, scaleY);
        
        // Apply limits: minimum scale and maximum scale
        const minScale = this.styles.polygonLabel.minScale || 0.3;
        const maxScale = this.styles.polygonLabel.maxScale || 2.0;
        
        const finalScale = Math.max(minScale, Math.min(maxScale, requiredScale));
        
        console.log(`📏 Polygon: ${polygonWidthPx.toFixed(0)}x${polygonHeightPx.toFixed(0)}px, Text: ${textWidthPx.toFixed(0)}x${textHeightPx.toFixed(0)}px, Scale: ${finalScale.toFixed(2)}`);
        
        return finalScale;
    }

    /**
     * Find nearby labels for grouping
     */
    findNearbyLabels(centerScreen, radius) {
        if (!this.collisionManager || !this.collisionManager.labelBounds) {
            return [];
        }
        
        const nearbyLabels = [];
        for (const [labelId, bounds] of this.collisionManager.labelBounds) {
            const labelCenter = {
                x: (bounds.left + bounds.right) / 2,
                y: (bounds.top + bounds.bottom) / 2
            };
            
            const distance = Math.sqrt(
                Math.pow(centerScreen.x - labelCenter.x, 2) + 
                Math.pow(centerScreen.y - labelCenter.y, 2)
            );
            
            if (distance < radius) {
                nearbyLabels.push(labelId); // Add the label ID or name
            }
        }
        
        return nearbyLabels;
    }

    /**
     * Add icons for point features
     */
    addPointIcons(style, feature, geometryType, properties) {
        if (geometryType !== 'Point') return;

        const pointRadius = this.styles.point.radius;
        const icon = properties.icon;

        if (icon && properties.feature_type !== MAP_CONSTANTS.FEATURE_TYPES.TURNING_POINT) {
            style.setText(new ol.style.Text({
                text: icon,
                font: '20px Arial',
                offsetY: -pointRadius - 10
            }));
        }
    }

    /**
     * Get selected feature style (highlighted)
     */
    getSelectedFeatureStyle(feature) {
        const geometry = feature.getGeometry();
        const geometryType = geometry.getType();
        
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
                    }) : undefined,
                zIndex: this.calculateZIndex(feature, geometryType) + 1000 // Selected features always on top
            });
        }
        
        // For other geometries, use modified original style
        const style = this.getFeatureStyle(feature);
        if (style.getStroke()) {
            style.getStroke().setColor('#ffff00');
            style.getStroke().setWidth(style.getStroke().getWidth() + 1);
        }
        if (style.getFill()) {
            style.getFill().setColor('rgba(255, 255, 0, 0.3)');
        }
        
        // Ensure selected feature is on top
        style.setZIndex(this.calculateZIndex(feature, geometryType) + 1000);
        
        return style;
    }

    /**
     * Get modify style (hidden for clean appearance)
     */
    getModifyStyle() {
        return null;
    }
    
    /**
     * Convert hex color to RGB values
     */
    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? 
            `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : 
            '255, 255, 255';
    }
}

// Global instance
window.FeatureStyleManager = FeatureStyleManager;