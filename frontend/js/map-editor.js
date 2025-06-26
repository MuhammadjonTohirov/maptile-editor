class MapEditor {
    constructor() {
        this.selectedFeature = null;
        this.currentInteraction = null;
        this.polygonModify = null;
        this.editingEnabled = false; // Start with editing disabled
        this.initMap();
        this.initLayers();
        this.initInteractions();
        this.initControls();
        this.loadFeatures();
        // Disable editing by default
        this.disableEditing();
    }

    initMap() {
        this.map = new ol.Map({
            target: 'map',
            layers: [
                new ol.layer.Tile({
                    source: new ol.source.OSM()
                })
            ],
            view: new ol.View({
                center: ol.proj.fromLonLat([0, 0]),
                zoom: 2
            })
        });
        
        // Try to center map on user's current location (without button interaction)
        this.getUserLocationAutomatic();
    }

    getUserLocation() {
        console.log('getUserLocation called');
        
        if (!navigator.geolocation) {
            console.log('Geolocation not supported by this browser');
            alert('Geolocation is not supported by this browser');
            return;
        }

        console.log('Requesting geolocation...');
        
        // Show loading indicator
        const button = document.getElementById('my-location');
        const originalText = button.textContent;
        button.textContent = '🔄 Getting location...';
        button.disabled = true;

        navigator.geolocation.getCurrentPosition(
            (position) => {
                console.log('Geolocation success:', position);
                const coords = [position.coords.longitude, position.coords.latitude];
                const mapCenter = ol.proj.fromLonLat(coords);
                
                this.map.getView().animate({
                    center: mapCenter,
                    zoom: 15,
                    duration: 1000
                });
                
                console.log(`Map centered on user location: ${coords[1]}, ${coords[0]}`);
                
                // Reset button
                button.textContent = originalText;
                button.disabled = false;
            },
            (error) => {
                console.error('Geolocation error:', error);
                let errorMessage = 'Could not get your location: ';
                
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        errorMessage += 'Permission denied. Please allow location access and try again.';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMessage += 'Location information is unavailable.';
                        break;
                    case error.TIMEOUT:
                        errorMessage += 'The request to get location timed out.';
                        break;
                    default:
                        errorMessage += 'An unknown error occurred.';
                        break;
                }
                
                console.log(errorMessage);
                alert(errorMessage);
                
                // Reset button
                button.textContent = originalText;
                button.disabled = false;
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 60000 // 1 minute
            }
        );
    }

    getUserLocationAutomatic() {
        console.log('Automatic geolocation called');
        
        if (!navigator.geolocation) {
            console.log('Geolocation not supported by this browser');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                console.log('Automatic geolocation success:', position);
                const coords = [position.coords.longitude, position.coords.latitude];
                const mapCenter = ol.proj.fromLonLat(coords);
                
                this.map.getView().setCenter(mapCenter);
                this.map.getView().setZoom(13);
                
                console.log(`Map automatically centered on user location: ${coords[1]}, ${coords[0]}`);
            },
            (error) => {
                console.log('Automatic geolocation failed:', error.message);
                console.log('Using default map center');
            },
            {
                enableHighAccuracy: false,
                timeout: 10000,
                maximumAge: 300000 // 5 minutes
            }
        );
    }

    initLayers() {
        this.vectorSource = new ol.source.Vector();
        this.vectorLayer = new ol.layer.Vector({
            source: this.vectorSource,
            style: this.getFeatureStyle.bind(this)
        });
        this.map.addLayer(this.vectorLayer);
        
        // Add zoom change listener for feature visibility
        this.map.getView().on('change:resolution', () => {
            this.updateFeatureVisibility();
        });
    }

    getFeatureStyle(feature) {
        const geometry = feature.getGeometry();
        const geometryType = geometry.getType();
        const isInPolygonEditMode = feature.get('polygon_edit_mode') === true;
        const properties = feature.get('properties') || {};
        const roadType = feature.get('road_type') || properties.road_type;
        const direction = feature.get('direction') || properties.direction;
        const featureType = properties.feature_type;
        
        // Check if feature should be visible at current zoom level
        const currentZoom = this.map.getView().getZoom();
        if (!this.shouldShowFeature(feature, currentZoom)) {
            return null; // Hide feature
        }
        
        let style;
        
        // Handle roads (LineString with road properties)
        if (geometryType === 'LineString' && (featureType === 'road' || roadType)) {
            const roadColor = this.getRoadColor(roadType);
            const roadWidth = this.getRoadWidth(roadType);
            
            const styles = [];
            
            // Handle bidirectional roads with dual lanes (only at detailed zoom levels)
            if (direction === 'bidirectional' && currentZoom >= 15) {
                styles.push(...this.getBidirectionalRoadStyles(roadColor, roadWidth));
            } else {
                // Single lane road
                styles.push(new ol.style.Style({
                    stroke: new ol.style.Stroke({
                        color: roadColor,
                        width: roadWidth
                    })
                }));
                
                // Add direction indicators based on zoom level
                if (direction && direction !== 'bidirectional') {
                    if (currentZoom >= 14 && currentZoom <= 16) {
                        // Triangular arrows for zoom 14-16
                        const arrowStyle = this.getArrowStyle(direction, roadColor);
                        if (arrowStyle) {
                            styles.push(arrowStyle);
                        }
                    } else if (currentZoom > 16) {
                        // Rectangular indicators for zoom > 16
                        styles.push(...this.getRoadRectangularStyles(roadColor, roadWidth, roadType));
                    }
                }
            }
            
            style = styles;
        }
        // Handle other geometries
        else {
            switch (geometryType) {
                case 'Point':
                    // Check if this is a street light
                    if (featureType === 'streetlight') {
                        style = new ol.style.Style({
                            image: new ol.style.Circle({
                                radius: 10,
                                fill: new ol.style.Fill({ color: 'rgba(255, 255, 0, 0.8)' }), // Yellow for visibility
                                stroke: new ol.style.Stroke({ color: '#ff8c00', width: 2 })
                            }),
                            text: new ol.style.Text({
                                text: '💡',
                                font: '16px Arial',
                                fill: new ol.style.Fill({ color: '#000' }),
                                offsetY: 0
                            })
                        });
                    } else if (featureType === 'traffic_light') {
                        style = new ol.style.Style({
                            image: new ol.style.Circle({
                                radius: 12,
                                fill: new ol.style.Fill({ color: 'rgba(255, 0, 0, 0.8)' }), // Red for traffic lights
                                stroke: new ol.style.Stroke({ color: '#8B0000', width: 3 })
                            }),
                            text: new ol.style.Text({
                                text: '🚦',
                                font: '18px Arial',
                                fill: new ol.style.Fill({ color: '#000' }),
                                offsetY: 0
                            })
                        });
                    } else {
                        style = new ol.style.Style({
                            image: new ol.style.Circle({
                                radius: 8,
                                fill: new ol.style.Fill({ color: 'rgba(0, 124, 186, 0.7)' }),
                                stroke: new ol.style.Stroke({ color: '#007cba', width: 2 })
                            })
                        });
                    }
                    break;
                case 'LineString':
                    style = new ol.style.Style({
                        stroke: new ol.style.Stroke({
                            color: '#007cba',
                            width: 3
                        })
                    });
                    break;
                case 'Polygon':
                    style = new ol.style.Style({
                        fill: new ol.style.Fill({ 
                            color: isInPolygonEditMode ? 'rgba(255, 107, 53, 0.3)' : 'rgba(0, 124, 186, 0.3)' 
                        }),
                        stroke: new ol.style.Stroke({ 
                            color: isInPolygonEditMode ? '#ff6b35' : '#007cba', 
                            width: isInPolygonEditMode ? 3 : 2 
                        })
                    });
                    break;
                default:
                    style = new ol.style.Style({
                        fill: new ol.style.Fill({ color: 'rgba(0, 124, 186, 0.3)' }),
                        stroke: new ol.style.Stroke({ color: '#007cba', width: 2 }),
                        image: new ol.style.Circle({
                            radius: 8,
                            fill: new ol.style.Fill({ color: 'rgba(0, 124, 186, 0.7)' }),
                            stroke: new ol.style.Stroke({ color: '#007cba', width: 2 })
                        })
                    });
            }
        }
        
        return style;
    }

    getRoadColor(roadType) {
        // Color roads by type
        switch (roadType) {
            case 'motorway':
            case 'motorway_link':
                return '#e892a2';  // Pink for highways
            case 'trunk':
            case 'trunk_link':
                return '#f9b29c';  // Orange for major roads
            case 'primary':
            case 'primary_link':
                return '#fcd6a4';  // Light orange for primary roads
            case 'secondary':
            case 'secondary_link':
                return '#f7fabf';  // Yellow for secondary roads
            case 'tertiary':
            case 'tertiary_link':
                return '#ffffff';  // White for tertiary roads
            case 'residential':
                return '#e8e8e8';  // Light gray for residential
            case 'service':
                return '#cccccc';  // Gray for service roads
            case 'footway':
            case 'path':
            case 'cycleway':
                return '#fa8072';  // Salmon for paths
            case 'steps':
                return '#fe9a76';  // Light salmon for steps
            default:
                return '#999999';  // Default gray
        }
    }

    getRoadWidth(roadType) {
        // Width roads by type
        switch (roadType) {
            case 'motorway':
            case 'motorway_link':
                return 8;
            case 'trunk':
            case 'trunk_link':
                return 7;
            case 'primary':
            case 'primary_link':
                return 6;
            case 'secondary':
            case 'secondary_link':
                return 5;
            case 'tertiary':
            case 'tertiary_link':
                return 4;
            case 'residential':
                return 3;
            case 'service':
                return 2;
            case 'footway':
            case 'path':
            case 'cycleway':
            case 'steps':
                return 2;
            default:
                return 3;
        }
    }

    getArrowStyle(direction, roadColor) {
        // Create arrow style for road direction
        return new ol.style.Style({
            geometry: function(feature) {
                const geometry = feature.getGeometry();
                const coordinates = geometry.getCoordinates();
                
                if (coordinates.length < 2) return null;
                
                // Calculate arrow positions along the line
                const arrows = [];
                const totalLength = coordinates.length;
                const step = Math.max(1, Math.floor(totalLength / 4)); // Place arrows every 25% of the line
                
                for (let i = step; i < totalLength - 1; i += step) {
                    arrows.push(coordinates[i]);
                }
                
                return new ol.geom.MultiPoint(arrows);
            },
            image: new ol.style.RegularShape({
                fill: new ol.style.Fill({ color: roadColor }),
                stroke: new ol.style.Stroke({ color: '#fff', width: 1 }),
                points: 3,
                radius: 8,
                rotation: direction === 'oneway_reverse' ? Math.PI : 0,
                angle: 0
            })
        });
    }

    getBidirectionalRoadStyles(roadColor, roadWidth) {
        const styles = [];
        const laneWidth = Math.max(2, roadWidth / 3); // Each lane is 1/3 of total width, minimum 2px
        const laneOffset = roadWidth / 4; // Offset from center
        
        // Left lane (slightly offset to the left)
        styles.push(new ol.style.Style({
            geometry: function(feature) {
                return this.getOffsetLineString(feature.getGeometry(), -laneOffset);
            }.bind(this),
            stroke: new ol.style.Stroke({
                color: roadColor,
                width: laneWidth
            })
        }));
        
        // Right lane (slightly offset to the right)
        styles.push(new ol.style.Style({
            geometry: function(feature) {
                return this.getOffsetLineString(feature.getGeometry(), laneOffset);
            }.bind(this),
            stroke: new ol.style.Stroke({
                color: roadColor,
                width: laneWidth
            })
        }));
        
        // Center divider line (thin yellow line)
        styles.push(new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: '#ffd700', // Gold/yellow for center line
                width: 1,
                lineDash: [5, 5] // Dashed line
            })
        }));
        
        return styles;
    }

    getRoadRectangularStyles(roadColor, roadWidth, roadType) {
        const styles = [];
        
        // Create rectangular direction indicators for roads at high zoom levels
        styles.push(new ol.style.Style({
            geometry: function(feature) {
                const geometry = feature.getGeometry();
                const coordinates = geometry.getCoordinates();
                
                if (coordinates.length < 2) return null;
                
                // Calculate intervals for direction indicators
                const totalLength = coordinates.length;
                const step = Math.max(2, Math.floor(totalLength / 5)); // Place 5 indicators per road
                
                const indicators = [];
                for (let i = step; i < totalLength - 1; i += step) {
                    indicators.push(coordinates[i]);
                }
                
                return new ol.geom.MultiPoint(indicators);
            },
            image: new ol.style.RegularShape({
                fill: new ol.style.Fill({ color: roadColor }),
                stroke: new ol.style.Stroke({ 
                    color: this.getDarkerColor(roadColor), 
                    width: 2 
                }),
                points: 4, // Rectangle
                radius: 8,
                radius2: 4, // Make it more rectangular (not square)
                angle: 0 // No rotation - proper rectangle orientation
            })
        }));
        
        return styles;
    }


    getDarkerColor(color) {
        // Convert color to darker version for border
        if (color.startsWith('#')) {
            // Handle hex colors
            const hex = color.slice(1);
            const r = Math.max(0, parseInt(hex.slice(0, 2), 16) - 40);
            const g = Math.max(0, parseInt(hex.slice(2, 4), 16) - 40);
            const b = Math.max(0, parseInt(hex.slice(4, 6), 16) - 40);
            return `rgb(${r}, ${g}, ${b})`;
        } else {
            // Return a default darker color
            return '#333333';
        }
    }

    getOffsetLineString(geometry, offset) {
        // Create a parallel line offset from the original
        const coordinates = geometry.getCoordinates();
        const offsetCoords = [];
        
        for (let i = 0; i < coordinates.length; i++) {
            const coord = coordinates[i];
            let perpendicular;
            
            if (i === 0) {
                // First point - use direction to next point
                const next = coordinates[i + 1];
                perpendicular = this.getPerpendicular(coord, next);
            } else if (i === coordinates.length - 1) {
                // Last point - use direction from previous point
                const prev = coordinates[i - 1];
                perpendicular = this.getPerpendicular(prev, coord);
            } else {
                // Middle point - average of two directions
                const prev = coordinates[i - 1];
                const next = coordinates[i + 1];
                const perp1 = this.getPerpendicular(prev, coord);
                const perp2 = this.getPerpendicular(coord, next);
                perpendicular = [(perp1[0] + perp2[0]) / 2, (perp1[1] + perp2[1]) / 2];
            }
            
            // Apply offset
            const offsetCoord = [
                coord[0] + perpendicular[0] * offset,
                coord[1] + perpendicular[1] * offset
            ];
            offsetCoords.push(offsetCoord);
        }
        
        return new ol.geom.LineString(offsetCoords);
    }

    getPerpendicular(point1, point2) {
        // Get normalized perpendicular vector
        const dx = point2[0] - point1[0];
        const dy = point2[1] - point1[1];
        const length = Math.sqrt(dx * dx + dy * dy);
        
        if (length === 0) return [0, 0];
        
        // Perpendicular vector (rotated 90 degrees)
        return [-dy / length * 0.00001, dx / length * 0.00001]; // Scale down for map coordinates
    }

    shouldShowFeature(feature, zoom) {
        const properties = feature.get('properties') || {};
        const roadType = feature.get('road_type') || properties.road_type;
        const featureType = properties.feature_type;
        const geometryType = feature.getGeometry().getType();
        
        // Define zoom thresholds for different feature types
        const zoomThresholds = {
            // Major roads - visible at all zooms
            motorway: 0,
            motorway_link: 0,
            trunk: 0,
            trunk_link: 0,
            
            // Primary roads - visible from zoom 8+
            primary: 8,
            primary_link: 8,
            
            // Secondary roads - visible from zoom 10+
            secondary: 10,
            secondary_link: 10,
            
            // Tertiary roads - visible from zoom 12+
            tertiary: 12,
            tertiary_link: 12,
            
            // Residential roads - visible from zoom 14+
            residential: 14,
            service: 14,
            
            // Paths and footways - visible from zoom 16+
            footway: 16,
            path: 16,
            cycleway: 16,
            steps: 16,
            
            // Buildings - visible from zoom 15+
            building: 15,
            
            // Street lights - visible from zoom 16+ (high detail level)
            streetlight: 16,
            
            // Traffic lights - visible from zoom 16+ (traffic navigation level)
            traffic_light: 16,
            
            // Turning points - visible from zoom 17+ (very detailed level)
            turning_point: 17,
            
            // Points and custom features - visible from zoom 13+
            point: 13,
            custom: 13
        };
        
        let minZoom = 0;
        
        if (featureType === 'road' && roadType) {
            // Road features
            minZoom = zoomThresholds[roadType] || 10;
        } else if (featureType === 'turning_point' || roadType === 'turning_point') {
            // Turning points - only visible at very high zoom
            minZoom = zoomThresholds.turning_point;
        } else if (featureType === 'streetlight') {
            // Street lights - visible at high zoom level
            minZoom = zoomThresholds.streetlight;
        } else if (featureType === 'traffic_light') {
            // Traffic lights - visible at traffic navigation level
            minZoom = zoomThresholds.traffic_light;
        } else if (geometryType === 'Polygon') {
            // Buildings and polygons
            minZoom = zoomThresholds.building;
        } else if (geometryType === 'Point') {
            // Points
            minZoom = zoomThresholds.point;
        } else {
            // Custom features and lines
            minZoom = zoomThresholds.custom;
        }
        
        return zoom >= minZoom;
    }

    updateFeatureVisibility() {
        // Update zoom level display
        const currentZoom = Math.round(this.map.getView().getZoom());
        document.getElementById('current-zoom').textContent = currentZoom;
        
        // Force re-render of all features to update visibility
        this.vectorLayer.getSource().changed();
    }

    getVertexStyle() {
        // Style for polygon vertices (draggable handles)
        return new ol.style.Style({
            image: new ol.style.Circle({
                radius: 8,
                fill: new ol.style.Fill({
                    color: 'white'
                }),
                stroke: new ol.style.Stroke({
                    color: '#007cba',
                    width: 3
                })
            })
        });
    }

    initInteractions() {
        this.drawPoint = new ol.interaction.Draw({
            source: this.vectorSource,
            type: 'Point'
        });

        this.drawLine = new ol.interaction.Draw({
            source: this.vectorSource,
            type: 'LineString'
        });

        this.drawPolygon = new ol.interaction.Draw({
            source: this.vectorSource,
            type: 'Polygon'
        });

        // Enhanced modify interaction with custom vertex styling - always active
        this.modify = new ol.interaction.Modify({
            source: this.vectorSource,
            style: this.getVertexStyle.bind(this)
        });

        // Add modify end event to auto-save when polygon is changed
        this.modify.on('modifyend', (event) => {
            const modifiedFeature = event.features.getArray()[0];
            if (modifiedFeature) {
                console.log('Polygon modified - auto-saving...');
                this.selectedFeature = modifiedFeature;
                this.autoSaveModifiedFeature(modifiedFeature);
            }
        });

        this.select = new ol.interaction.Select({
            layers: [this.vectorLayer]
        });

        this.select.on('select', (event) => {
            if (event.selected.length > 0) {
                this.selectedFeature = event.selected[0];
                this.showFeatureInfo(this.selectedFeature);
            } else {
                this.selectedFeature = null;
                this.hideFeatureInfo();
            }
        });

        // Always add select interaction so polygons are always selectable
        this.map.addInteraction(this.select);
        // Modify interaction will be added/removed based on editing state

        [this.drawPoint, this.drawLine, this.drawPolygon].forEach(interaction => {
            interaction.on('drawend', (event) => {
                this.selectedFeature = event.feature;
                this.showFeatureInfo(this.selectedFeature);
            });
        });
    }

    initControls() {
        document.getElementById('toggle-editing').addEventListener('click', () => {
            this.toggleEditing();
        });

        document.getElementById('draw-point').addEventListener('click', () => {
            this.setActiveInteraction('point');
        });

        document.getElementById('draw-line').addEventListener('click', () => {
            this.setActiveInteraction('line');
        });

        document.getElementById('draw-polygon').addEventListener('click', () => {
            this.setActiveInteraction('polygon');
        });


        document.getElementById('select').addEventListener('click', () => {
            this.setActiveInteraction('select');
        });

        document.getElementById('delete').addEventListener('click', () => {
            this.deleteSelectedFeature();
        });

        document.getElementById('clear-all').addEventListener('click', () => {
            this.clearAllFeatures();
        });

        document.getElementById('save-all').addEventListener('click', () => {
            this.saveAllFeatures();
        });

        document.getElementById('load-features').addEventListener('click', () => {
            this.loadFeatures();
        });

        document.getElementById('save-feature').addEventListener('click', () => {
            this.saveSelectedFeature();
        });

        document.getElementById('cancel-edit').addEventListener('click', () => {
            this.hideFeatureInfo();
        });

        document.getElementById('my-location').addEventListener('click', () => {
            this.getUserLocation();
        });

        document.getElementById('load-buildings').addEventListener('click', () => {
            this.loadOSMBuildings();
        });

        document.getElementById('load-roads').addEventListener('click', () => {
            this.loadOSMRoads();
        });

        document.getElementById('load-streetlights').addEventListener('click', () => {
            this.loadOSMStreetlights();
        });

        document.getElementById('load-traffic-lights').addEventListener('click', () => {
            this.loadOSMTrafficLights();
        });
    }

    setActiveInteraction(type) {
        // Check if editing is enabled for drawing tools
        if (!this.editingEnabled && ['point', 'line', 'polygon'].includes(type)) {
            alert('Please enable editing first by clicking the "🔒 Lock Editing" button');
            return;
        }
        
        this.map.removeInteraction(this.currentInteraction);
        
        document.querySelectorAll('.controls button').forEach(btn => {
            btn.classList.remove('active');
        });

        switch (type) {
            case 'point':
                this.currentInteraction = this.drawPoint;
                document.getElementById('draw-point').classList.add('active');
                break;
            case 'line':
                this.currentInteraction = this.drawLine;
                document.getElementById('draw-line').classList.add('active');
                break;
            case 'polygon':
                this.currentInteraction = this.drawPolygon;
                document.getElementById('draw-polygon').classList.add('active');
                break;
            case 'select':
                this.currentInteraction = this.select;
                document.getElementById('select').classList.add('active');
                break;
        }

        if (this.currentInteraction) {
            this.map.addInteraction(this.currentInteraction);
        }
    }

    toggleEditing() {
        this.editingEnabled = !this.editingEnabled;
        
        const button = document.getElementById('toggle-editing');
        
        if (this.editingEnabled) {
            this.enableEditing();
            button.textContent = '🔓 Unlock Editing';
            button.classList.add('editing-enabled');
        } else {
            this.disableEditing();
            button.textContent = '🔒 Lock Editing';
            button.classList.remove('editing-enabled');
        }
    }

    enableEditing() {
        // Add modify interaction for polygon editing
        this.map.addInteraction(this.modify);
        
        // Enable drawing tools
        document.querySelectorAll('#draw-point, #draw-line, #draw-polygon, #delete').forEach(btn => {
            btn.disabled = false;
            btn.style.opacity = '1';
        });
        
        console.log('Editing enabled - you can now modify features');
    }

    disableEditing() {
        // Remove modify interaction
        this.map.removeInteraction(this.modify);
        
        // Remove any active drawing interactions
        this.map.removeInteraction(this.currentInteraction);
        this.currentInteraction = null;
        
        // Disable drawing tools
        document.querySelectorAll('#draw-point, #draw-line, #draw-polygon, #delete').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
        });
        
        // Clear active button states
        document.querySelectorAll('.controls button').forEach(btn => {
            btn.classList.remove('active');
        });
        
        console.log('Editing disabled - features are protected from accidental changes');
    }

    autoSaveModifiedFeature(feature) {
        const properties = feature.get('properties') || {};
        
        const geometry = feature.getGeometry();
        const geoJsonGeometry = new ol.format.GeoJSON().writeGeometry(geometry, {
            dataProjection: 'EPSG:4326',
            featureProjection: 'EPSG:3857'
        });
        
        // Ensure geometry is an object, not a string
        const geometryObj = typeof geoJsonGeometry === 'string' ? JSON.parse(geoJsonGeometry) : geoJsonGeometry;
        
        const featureData = {
            name: properties.name || feature.get('name') || '',
            description: properties.description || feature.get('description') || '',
            geometry: geometryObj,
            properties: properties,
            building_number: properties.building_number || feature.get('building_number') || '',
            building_type: properties.building_type || feature.get('building_type') || '',
            icon: properties.icon || feature.get('icon') || '',
            osm_id: feature.get('osm_id') || null
        };

        const featureId = feature.get('id');
        
        if (featureId) {
            this.updateFeatureOnServer(featureId, featureData);
        } else {
            this.createFeatureOnServer(featureData);
        }
    }

    showFeatureInfo(feature) {
        const properties = feature.get('properties') || {};
        document.getElementById('feature-name').value = properties.name || feature.get('name') || '';
        document.getElementById('feature-description').value = properties.description || feature.get('description') || '';
        document.getElementById('building-number').value = properties.building_number || feature.get('building_number') || '';
        document.getElementById('building-type').value = properties.building_type || feature.get('building_type') || '';
        document.getElementById('building-icon').value = properties.icon || feature.get('icon') || '';
        document.getElementById('feature-info').style.display = 'block';
    }

    hideFeatureInfo() {
        document.getElementById('feature-info').style.display = 'none';
        this.selectedFeature = null;
    }

    deleteSelectedFeature() {
        if (this.selectedFeature) {
            const featureId = this.selectedFeature.get('id');
            if (featureId) {
                this.deleteFeatureFromServer(featureId);
            }
            this.vectorSource.removeFeature(this.selectedFeature);
            this.hideFeatureInfo();
        }
    }

    clearAllFeatures() {
        if (confirm('Are you sure you want to clear all features?')) {
            this.vectorSource.clear();
            this.hideFeatureInfo();
        }
    }

    saveSelectedFeature() {
        if (!this.selectedFeature) return;

        const name = document.getElementById('feature-name').value;
        const description = document.getElementById('feature-description').value;
        const buildingNumber = document.getElementById('building-number').value;
        const buildingType = document.getElementById('building-type').value;
        const icon = document.getElementById('building-icon').value;
        
        const properties = {
            name: name,
            description: description,
            building_number: buildingNumber,
            building_type: buildingType,
            icon: icon,
            ...this.selectedFeature.get('properties')
        };
        
        this.selectedFeature.set('properties', properties);

        const geometry = this.selectedFeature.getGeometry();
        const geoJsonGeometry = new ol.format.GeoJSON().writeGeometry(geometry, {
            dataProjection: 'EPSG:4326',
            featureProjection: 'EPSG:3857'
        });
        
        // Ensure geometry is an object, not a string
        const geometryObj = typeof geoJsonGeometry === 'string' ? JSON.parse(geoJsonGeometry) : geoJsonGeometry;
        
        const featureData = {
            name: name,
            description: description,
            geometry: geometryObj,
            properties: properties,
            building_number: buildingNumber,
            building_type: buildingType,
            icon: icon,
            osm_id: this.selectedFeature.get('osm_id') || null
        };

        console.log('Saving feature data:', featureData);

        const featureId = this.selectedFeature.get('id');
        
        if (featureId) {
            this.updateFeatureOnServer(featureId, featureData);
        } else {
            this.createFeatureOnServer(featureData);
        }

        this.hideFeatureInfo();
    }

    async createFeatureOnServer(featureData) {
        try {
            const response = await fetch('/api/features', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(featureData)
            });

            if (response.ok) {
                const result = await response.json();
                this.selectedFeature.set('id', result.id);
                console.log('Feature created successfully:', result);
            } else {
                const errorText = await response.text();
                console.error('Failed to create feature:', response.status, errorText);
                alert(`Failed to create feature: ${response.status} - ${errorText}`);
            }
        } catch (error) {
            console.error('Error creating feature:', error);
        }
    }

    async updateFeatureOnServer(featureId, featureData) {
        try {
            const response = await fetch(`/api/features/${featureId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(featureData)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('Feature updated successfully:', result);
            } else {
                const errorText = await response.text();
                console.error('Failed to update feature:', response.status, errorText);
                alert(`Failed to update feature: ${response.status} - ${errorText}`);
            }
        } catch (error) {
            console.error('Error updating feature:', error);
        }
    }

    async deleteFeatureFromServer(featureId) {
        try {
            const response = await fetch(`/api/features/${featureId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                console.log('Feature deleted successfully');
            } else {
                console.error('Failed to delete feature');
            }
        } catch (error) {
            console.error('Error deleting feature:', error);
        }
    }

    async loadFeatures() {
        try {
            const response = await fetch('/api/features');
            
            if (response.ok) {
                const geoJsonData = await response.json();
                const format = new ol.format.GeoJSON();
                
                this.vectorSource.clear();
                
                geoJsonData.features.forEach(feature => {
                    const olFeature = format.readFeature(feature, {
                        featureProjection: 'EPSG:3857'
                    });
                    olFeature.set('id', feature.id);
                    olFeature.set('properties', feature.properties);
                    
                    // Set feature-specific properties
                    olFeature.set('name', feature.properties.name || '');
                    olFeature.set('description', feature.properties.description || '');
                    olFeature.set('building_number', feature.properties.building_number || '');
                    olFeature.set('building_type', feature.properties.building_type || '');
                    olFeature.set('icon', feature.properties.icon || '');
                    olFeature.set('osm_id', feature.properties.osm_id || '');
                    // Set road-specific properties
                    olFeature.set('road_type', feature.properties.road_type || '');
                    olFeature.set('direction', feature.properties.direction || '');
                    olFeature.set('lane_count', feature.properties.lane_count || null);
                    olFeature.set('max_speed', feature.properties.max_speed || null);
                    olFeature.set('surface', feature.properties.surface || '');
                    
                    this.vectorSource.addFeature(olFeature);
                });
                
                if (geoJsonData.features.length > 0) {
                    const extent = this.vectorSource.getExtent();
                    this.map.getView().fit(extent, { padding: [20, 20, 20, 20] });
                }
                
                console.log(`Loaded ${geoJsonData.features.length} features`);
            } else {
                console.error('Failed to load features');
            }
        } catch (error) {
            console.error('Error loading features:', error);
        }
    }

    async saveAllFeatures() {
        const features = this.vectorSource.getFeatures();
        let savedCount = 0;
        
        for (const feature of features) {
            const featureId = feature.get('id');
            const properties = feature.get('properties') || {};
            
            const geometry = feature.getGeometry();
            const geoJsonGeometry = new ol.format.GeoJSON().writeGeometry(geometry, {
                dataProjection: 'EPSG:4326',
                featureProjection: 'EPSG:3857'
            });
            
            // Ensure geometry is an object, not a string
            const geometryObj = typeof geoJsonGeometry === 'string' ? JSON.parse(geoJsonGeometry) : geoJsonGeometry;
            
            const featureData = {
                name: properties.name || '',
                description: properties.description || '',
                geometry: geometryObj,
                properties: properties
            };

            try {
                if (featureId) {
                    await this.updateFeatureOnServer(featureId, featureData);
                } else {
                    const response = await fetch('/api/features', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(featureData)
                    });

                    if (response.ok) {
                        const result = await response.json();
                        feature.set('id', result.id);
                    }
                }
                savedCount++;
            } catch (error) {
                console.error('Error saving feature:', error);
            }
        }
        
        alert(`Saved ${savedCount} features`);
    }

    async loadOSMBuildings() {
        const view = this.map.getView();
        const extent = view.calculateExtent(this.map.getSize());
        const [minX, minY, maxX, maxY] = ol.proj.transformExtent(extent, 'EPSG:3857', 'EPSG:4326');
        
        const bounds = {
            west: minX,
            south: minY,
            east: maxX,
            north: maxY
        };

        const button = document.getElementById('load-buildings');
        const originalText = button.textContent;
        button.textContent = '🔄 Loading buildings...';
        button.disabled = true;

        try {
            const response = await fetch('/api/load-osm-buildings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(bounds)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('OSM buildings loaded:', result);
                alert(`Loaded ${result.buildings_loaded} buildings from OpenStreetMap`);
                
                // Reload features to show the new buildings
                await this.loadFeatures();
            } else {
                const errorText = await response.text();
                console.error('Failed to load OSM buildings:', response.status, errorText);
                alert(`Failed to load buildings: ${response.status} - ${errorText}`);
            }
        } catch (error) {
            console.error('Error loading OSM buildings:', error);
            alert('Error loading buildings from OpenStreetMap');
        } finally {
            button.textContent = originalText;
            button.disabled = false;
        }
    }

    async loadOSMRoads() {
        const view = this.map.getView();
        const extent = view.calculateExtent(this.map.getSize());
        const [minX, minY, maxX, maxY] = ol.proj.transformExtent(extent, 'EPSG:3857', 'EPSG:4326');
        
        const bounds = {
            west: minX,
            south: minY,
            east: maxX,
            north: maxY
        };

        const button = document.getElementById('load-roads');
        const originalText = button.textContent;
        button.textContent = '🔄 Loading roads...';
        button.disabled = true;

        try {
            const response = await fetch('/api/load-osm-roads', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(bounds)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('OSM roads loaded:', result);
                alert(`Loaded ${result.roads_loaded} roads from OpenStreetMap`);
                
                // Reload features to show the new roads
                await this.loadFeatures();
            } else {
                const errorText = await response.text();
                console.error('Failed to load OSM roads:', response.status, errorText);
                alert(`Failed to load roads: ${response.status} - ${errorText}`);
            }
        } catch (error) {
            console.error('Error loading OSM roads:', error);
            alert('Error loading roads from OpenStreetMap');
        } finally {
            button.textContent = originalText;
            button.disabled = false;
        }
    }

    async loadOSMStreetlights() {
        const view = this.map.getView();
        const extent = view.calculateExtent(this.map.getSize());
        const [minX, minY, maxX, maxY] = ol.proj.transformExtent(extent, 'EPSG:3857', 'EPSG:4326');
        
        const bounds = {
            west: minX,
            south: minY,
            east: maxX,
            north: maxY
        };

        const button = document.getElementById('load-streetlights');
        const originalText = button.textContent;
        button.textContent = '🔄 Loading street lights...';
        button.disabled = true;

        try {
            const response = await fetch('/api/load-osm-streetlights', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(bounds)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('OSM street lights loaded:', result);
                alert(`Loaded ${result.streetlights_loaded} street lights from OpenStreetMap`);
                
                // Reload features to show the new street lights
                await this.loadFeatures();
            } else {
                const errorText = await response.text();
                console.error('Failed to load OSM street lights:', response.status, errorText);
                alert(`Failed to load street lights: ${response.status} - ${errorText}`);
            }
        } catch (error) {
            console.error('Error loading OSM street lights:', error);
            alert('Error loading street lights from OpenStreetMap');
        } finally {
            button.textContent = originalText;
            button.disabled = false;
        }
    }

    async loadOSMTrafficLights() {
        const view = this.map.getView();
        const extent = view.calculateExtent(this.map.getSize());
        const [minX, minY, maxX, maxY] = ol.proj.transformExtent(extent, 'EPSG:3857', 'EPSG:4326');
        
        const bounds = {
            west: minX,
            south: minY,
            east: maxX,
            north: maxY
        };

        const button = document.getElementById('load-traffic-lights');
        const originalText = button.textContent;
        button.textContent = '🔄 Loading traffic lights...';
        button.disabled = true;

        try {
            const response = await fetch('/api/load-osm-traffic-lights', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(bounds)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('OSM traffic lights loaded:', result);
                alert(`Loaded ${result.traffic_lights_loaded} traffic lights from OpenStreetMap`);
                
                // Reload features to show the new traffic lights
                await this.loadFeatures();
            } else {
                const errorText = await response.text();
                console.error('Failed to load OSM traffic lights:', response.status, errorText);
                alert(`Failed to load traffic lights: ${response.status} - ${errorText}`);
            }
        } catch (error) {
            console.error('Error loading OSM traffic lights:', error);
            alert('Error loading traffic lights from OpenStreetMap');
        } finally {
            button.textContent = originalText;
            button.disabled = false;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new MapEditor();
});