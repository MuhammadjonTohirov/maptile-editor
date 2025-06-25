class MapEditor {
    constructor() {
        this.selectedFeature = null;
        this.currentInteraction = null;
        this.initMap();
        this.initLayers();
        this.initInteractions();
        this.initControls();
        this.loadFeatures();
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
    }

    getFeatureStyle(feature) {
        const geometry = feature.getGeometry();
        const geometryType = geometry.getType();
        
        let style;
        switch (geometryType) {
            case 'Point':
                style = new ol.style.Style({
                    image: new ol.style.Circle({
                        radius: 8,
                        fill: new ol.style.Fill({ color: 'rgba(0, 124, 186, 0.7)' }),
                        stroke: new ol.style.Stroke({ color: '#007cba', width: 2 })
                    })
                });
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
                    fill: new ol.style.Fill({ color: 'rgba(0, 124, 186, 0.3)' }),
                    stroke: new ol.style.Stroke({ color: '#007cba', width: 2 })
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
        
        return style;
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

        this.modify = new ol.interaction.Modify({
            source: this.vectorSource
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

        [this.drawPoint, this.drawLine, this.drawPolygon].forEach(interaction => {
            interaction.on('drawend', (event) => {
                this.selectedFeature = event.feature;
                this.showFeatureInfo(this.selectedFeature);
            });
        });
    }

    initControls() {
        document.getElementById('draw-point').addEventListener('click', () => {
            this.setActiveInteraction('point');
        });

        document.getElementById('draw-line').addEventListener('click', () => {
            this.setActiveInteraction('line');
        });

        document.getElementById('draw-polygon').addEventListener('click', () => {
            this.setActiveInteraction('polygon');
        });

        document.getElementById('modify').addEventListener('click', () => {
            this.setActiveInteraction('modify');
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
    }

    setActiveInteraction(type) {
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
            case 'modify':
                this.currentInteraction = this.modify;
                document.getElementById('modify').classList.add('active');
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
                    
                    // Set building-specific properties
                    olFeature.set('name', feature.properties.name || '');
                    olFeature.set('description', feature.properties.description || '');
                    olFeature.set('building_number', feature.properties.building_number || '');
                    olFeature.set('building_type', feature.properties.building_type || '');
                    olFeature.set('icon', feature.properties.icon || '');
                    olFeature.set('osm_id', feature.properties.osm_id || '');
                    
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
}

document.addEventListener('DOMContentLoaded', () => {
    new MapEditor();
});