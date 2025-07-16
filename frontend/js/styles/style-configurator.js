/**
 * Style Configurator
 * GUI for configuring feature styles
 */

class StyleConfigurator {
    constructor() {
        this.defaultStyles = {
            point: {
                color: '#3399CC',
                radius: 8,
                borderColor: '#ffffff',
                borderWidth: 2
            },
            line: {
                color: '#ff6b35',
                width: 3
            },
            polygon: {
                fillColor: '#ff6b35',
                fillOpacity: 0.2,
                borderColor: '#ff6b35',
                borderWidth: 2
            },
            road: {
                color: '#555555',
                width: 4,
                serviceRoadMinZoom: 15
            },
            footway: {
                color: '#8B4513',
                width: 2,
                minZoom: 16,
                enabled: true
            },
            minorRoad: {
                color: '#999999',
                width: 1.5
            },
            serviceRoad: {
                color: '#CCCCCC',
                width: 1
            },
            building: {
                fillColor: '#8a2be2',
                fillOpacity: 0.3,
                borderColor: '#8a2be2'
            },
            landuse: {
                fillColor: '#98D982',
                fillOpacity: 0.4,
                borderColor: '#7CB668'
            },
            natural: {
                fillColor: '#A8CC8C',
                fillOpacity: 0.4,
                borderColor: '#88B86C'
            },
            leisure: {
                fillColor: '#4CAF50',
                fillOpacity: 0.3,
                borderColor: '#45A049'
            },
            amenity: {
                fillColor: '#FF9800',
                fillOpacity: 0.4,
                borderColor: '#F57C00'
            },
            transportation: {
                fillColor: '#9E9E9E',
                fillOpacity: 0.5,
                borderColor: '#757575'
            },
            water: {
                fillColor: '#2196F3',
                fillOpacity: 0.6,
                borderColor: '#1976D2'
            },
            sport: {
                fillColor: '#FFC107',
                fillOpacity: 0.4,
                borderColor: '#FFA000'
            },
            utility: {
                fillColor: '#E91E63',
                fillOpacity: 0.4,
                borderColor: '#C2185B'
            },
            streetlight: {
                color: '#ffeb3b'
            },
            trafficLight: {
                color: '#f44336'
            },
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
                minZoom: 12,
                iconEnabled: true,
                iconSize: 20,
                minScale: 0.3,
                maxScale: 2.0,
                paddingFactor: 0.8
            }
        };
        
        this.currentStyles = { ...this.defaultStyles };
        this.init();
    }
    
    init() {
        this.loadStoredStyles();
        this.setupEventListeners();
        this.updateAllPreviews();
        this.syncInputValues();
    }
    
    setupEventListeners() {
        // Point controls
        this.setupColorInput('point-color', 'point-color-text', 'point', 'color');
        this.setupRangeInput('point-radius', 'point-radius-value', 'point', 'radius');
        this.setupColorInput('point-border-color', 'point-border-color-text', 'point', 'borderColor');
        this.setupRangeInput('point-border-width', 'point-border-width-value', 'point', 'borderWidth');
        
        // Line controls
        this.setupColorInput('line-color', 'line-color-text', 'line', 'color');
        this.setupRangeInput('line-width', 'line-width-value', 'line', 'width');
        
        // Polygon controls
        this.setupColorInput('polygon-fill-color', 'polygon-fill-color-text', 'polygon', 'fillColor');
        this.setupRangeInput('polygon-fill-opacity', 'polygon-fill-opacity-value', 'polygon', 'fillOpacity', (val) => val / 100, (val) => `${val}%`);
        this.setupColorInput('polygon-border-color', 'polygon-border-color-text', 'polygon', 'borderColor');
        this.setupRangeInput('polygon-border-width', 'polygon-border-width-value', 'polygon', 'borderWidth');
        
        // Road controls
        this.setupColorInput('road-color', 'road-color-text', 'road', 'color');
        this.setupRangeInput('road-width', 'road-width-value', 'road', 'width');
        this.setupRangeInput('service-road-min-zoom', 'service-road-min-zoom-value', 'road', 'serviceRoadMinZoom', (val) => parseInt(val));
        
        // Footway controls
        this.setupColorInput('footway-color', 'footway-color-text', 'footway', 'color');
        this.setupRangeInput('footway-width', 'footway-width-value', 'footway', 'width');
        this.setupRangeInput('footway-min-zoom', 'footway-min-zoom-value', 'footway', 'minZoom', (val) => parseInt(val));
        
        // Footway enabled/disabled
        document.getElementById('footway-enabled').addEventListener('change', (e) => {
            this.currentStyles.footway.enabled = e.target.value === 'true';
        });
        
        // Minor road controls
        this.setupColorInput('minor-road-color', 'minor-road-color-text', 'minorRoad', 'color');
        this.setupRangeInput('minor-road-width', 'minor-road-width-value', 'minorRoad', 'width');
        
        // Service road controls
        this.setupColorInput('service-road-color', 'service-road-color-text', 'serviceRoad', 'color');
        this.setupRangeInput('service-road-width', 'service-road-width-value', 'serviceRoad', 'width');
        
        // Building controls
        this.setupColorInput('building-fill-color', 'building-fill-color-text', 'building', 'fillColor');
        this.setupRangeInput('building-fill-opacity', 'building-fill-opacity-value', 'building', 'fillOpacity', (val) => val / 100, (val) => `${val}%`);
        this.setupColorInput('building-border-color', 'building-border-color-text', 'building', 'borderColor');
        
        // Special feature controls
        this.setupColorInput('streetlight-color', 'streetlight-color-text', 'streetlight', 'color');
        this.setupColorInput('traffic-light-color', 'traffic-light-color-text', 'trafficLight', 'color');
        
        // Street label controls
        this.setupRangeInput('street-label-size', 'street-label-size-value', 'streetLabel', 'fontSize', (val) => parseInt(val), (val) => `${val}px`);
        this.setupColorInput('street-label-color', 'street-label-color-text', 'streetLabel', 'color');
        this.setupColorInput('street-label-outline', 'street-label-outline-text', 'streetLabel', 'outlineColor');
        this.setupRangeInput('street-label-outline-width', 'street-label-outline-width-value', 'streetLabel', 'outlineWidth', (val) => parseInt(val), (val) => `${val}px`);
        this.setupRangeInput('street-label-repeat', 'street-label-repeat-value', 'streetLabel', 'repeat', (val) => parseInt(val), (val) => `${val}px`);
        this.setupRangeInput('street-label-min-zoom', 'street-label-min-zoom-value', 'streetLabel', 'minZoom', (val) => parseInt(val));
        
        // Street label enabled/disabled
        document.getElementById('street-label-enabled').addEventListener('change', (e) => {
            this.currentStyles.streetLabel.enabled = e.target.value === 'true';
        });
        
        // Performance mode
        document.getElementById('street-label-performance').addEventListener('change', (e) => {
            this.currentStyles.streetLabel.performance = e.target.value;
        });
        
        // Polygon label controls
        this.setupRangeInput('polygon-label-size', 'polygon-label-size-value', 'polygonLabel', 'fontSize', (val) => parseInt(val), (val) => `${val}px`);
        this.setupColorInput('polygon-label-color', 'polygon-label-color-text', 'polygonLabel', 'color');
        this.setupColorInput('polygon-label-outline', 'polygon-label-outline-text', 'polygonLabel', 'outlineColor');
        this.setupRangeInput('polygon-label-min-zoom', 'polygon-label-min-zoom-value', 'polygonLabel', 'minZoom', (val) => parseInt(val));
        this.setupRangeInput('polygon-icon-size', 'polygon-icon-size-value', 'polygonLabel', 'iconSize', (val) => parseInt(val), (val) => `${val}px`);
        this.setupRangeInput('polygon-min-scale', 'polygon-min-scale-value', 'polygonLabel', 'minScale', (val) => parseFloat(val));
        this.setupRangeInput('polygon-max-scale', 'polygon-max-scale-value', 'polygonLabel', 'maxScale', (val) => parseFloat(val));
        this.setupRangeInput('polygon-padding-factor', 'polygon-padding-factor-value', 'polygonLabel', 'paddingFactor', (val) => parseFloat(val));
        
        // Polygon icon enabled/disabled
        document.getElementById('polygon-icon-enabled').addEventListener('change', (e) => {
            this.currentStyles.polygonLabel.iconEnabled = e.target.value === 'true';
        });
        
        // Action buttons
        document.getElementById('apply-styles').addEventListener('click', () => this.applyStyles());
        document.getElementById('reset-styles').addEventListener('click', () => this.resetStyles());
        document.getElementById('save-styles').addEventListener('click', () => this.saveStyles());
        document.getElementById('export-config').addEventListener('click', () => this.exportConfig());
        document.getElementById('import-config-btn').addEventListener('click', () => {
            document.getElementById('import-config').click();
        });
        document.getElementById('import-config').addEventListener('change', (e) => this.importConfig(e));
    }
    
    setupColorInput(colorId, textId, category, property) {
        const colorInput = document.getElementById(colorId);
        const textInput = document.getElementById(textId);
        
        const updateColor = (value) => {
            this.currentStyles[category][property] = value;
            colorInput.value = value;
            textInput.value = value;
            this.updatePreview(category);
        };
        
        colorInput.addEventListener('input', (e) => updateColor(e.target.value));
        textInput.addEventListener('input', (e) => {
            if (this.isValidColor(e.target.value)) {
                updateColor(e.target.value);
            }
        });
    }
    
    setupRangeInput(rangeId, valueId, category, property, transform = (val) => parseInt(val), displayTransform = (val) => val.toString()) {
        const rangeInput = document.getElementById(rangeId);
        const valueDisplay = document.getElementById(valueId);
        
        rangeInput.addEventListener('input', (e) => {
            const value = transform(e.target.value);
            this.currentStyles[category][property] = value;
            valueDisplay.textContent = displayTransform(value);
            this.updatePreview(category);
        });
    }
    
    updatePreview(category) {
        switch (category) {
            case 'point':
                this.updatePointPreview('point-preview', this.currentStyles.point);
                break;
            case 'line':
                this.updateLinePreview('line-preview', this.currentStyles.line);
                break;
            case 'polygon':
                this.updatePolygonPreview('polygon-preview', this.currentStyles.polygon);
                break;
            case 'road':
                this.updateLinePreview('road-preview', this.currentStyles.road);
                break;
            case 'building':
                this.updatePolygonPreview('building-preview', this.currentStyles.building);
                break;
            case 'streetlight':
                this.updatePointPreview('streetlight-preview', this.currentStyles.streetlight);
                break;
            case 'trafficLight':
                this.updatePointPreview('traffic-light-preview', this.currentStyles.trafficLight);
                break;
        }
    }
    
    updatePointPreview(elementId, styles) {
        const element = document.getElementById(elementId);
        element.style.backgroundColor = styles.color;
        element.style.width = `${styles.radius * 2}px`;
        element.style.height = `${styles.radius * 2}px`;
        if (styles.borderColor && styles.borderWidth) {
            element.style.border = `${styles.borderWidth}px solid ${styles.borderColor}`;
        }
    }
    
    updateLinePreview(elementId, styles) {
        const element = document.getElementById(elementId);
        element.style.backgroundColor = styles.color;
        element.style.height = `${styles.width}px`;
    }
    
    updatePolygonPreview(elementId, styles) {
        const element = document.getElementById(elementId);
        const fillColor = this.addOpacityToColor(styles.fillColor, styles.fillOpacity || 0.2);
        element.style.backgroundColor = fillColor;
        element.style.border = `2px solid ${styles.borderColor}`;
    }
    
    updateAllPreviews() {
        this.updatePreview('point');
        this.updatePreview('line');
        this.updatePreview('polygon');
        this.updatePreview('road');
        this.updatePreview('building');
        this.updatePreview('streetlight');
        this.updatePreview('trafficLight');
    }
    
    syncInputValues() {
        // Point
        document.getElementById('point-color').value = this.currentStyles.point.color;
        document.getElementById('point-color-text').value = this.currentStyles.point.color;
        document.getElementById('point-radius').value = this.currentStyles.point.radius;
        document.getElementById('point-radius-value').textContent = this.currentStyles.point.radius;
        document.getElementById('point-border-color').value = this.currentStyles.point.borderColor;
        document.getElementById('point-border-color-text').value = this.currentStyles.point.borderColor;
        document.getElementById('point-border-width').value = this.currentStyles.point.borderWidth;
        document.getElementById('point-border-width-value').textContent = this.currentStyles.point.borderWidth;
        
        // Line
        document.getElementById('line-color').value = this.currentStyles.line.color;
        document.getElementById('line-color-text').value = this.currentStyles.line.color;
        document.getElementById('line-width').value = this.currentStyles.line.width;
        document.getElementById('line-width-value').textContent = this.currentStyles.line.width;
        
        // Polygon
        document.getElementById('polygon-fill-color').value = this.currentStyles.polygon.fillColor;
        document.getElementById('polygon-fill-color-text').value = this.currentStyles.polygon.fillColor;
        document.getElementById('polygon-fill-opacity').value = this.currentStyles.polygon.fillOpacity * 100;
        document.getElementById('polygon-fill-opacity-value').textContent = `${this.currentStyles.polygon.fillOpacity * 100}%`;
        document.getElementById('polygon-border-color').value = this.currentStyles.polygon.borderColor;
        document.getElementById('polygon-border-color-text').value = this.currentStyles.polygon.borderColor;
        document.getElementById('polygon-border-width').value = this.currentStyles.polygon.borderWidth;
        document.getElementById('polygon-border-width-value').textContent = this.currentStyles.polygon.borderWidth;
        
        // Road
        document.getElementById('road-color').value = this.currentStyles.road.color;
        document.getElementById('road-color-text').value = this.currentStyles.road.color;
        document.getElementById('road-width').value = this.currentStyles.road.width;
        document.getElementById('road-width-value').textContent = this.currentStyles.road.width;
        document.getElementById('service-road-min-zoom').value = this.currentStyles.road.serviceRoadMinZoom;
        document.getElementById('service-road-min-zoom-value').textContent = this.currentStyles.road.serviceRoadMinZoom;
        
        // Footway
        document.getElementById('footway-color').value = this.currentStyles.footway.color;
        document.getElementById('footway-color-text').value = this.currentStyles.footway.color;
        document.getElementById('footway-width').value = this.currentStyles.footway.width;
        document.getElementById('footway-width-value').textContent = this.currentStyles.footway.width;
        document.getElementById('footway-min-zoom').value = this.currentStyles.footway.minZoom;
        document.getElementById('footway-min-zoom-value').textContent = this.currentStyles.footway.minZoom;
        document.getElementById('footway-enabled').value = this.currentStyles.footway.enabled.toString();
        
        // Minor roads
        document.getElementById('minor-road-color').value = this.currentStyles.minorRoad.color;
        document.getElementById('minor-road-color-text').value = this.currentStyles.minorRoad.color;
        document.getElementById('minor-road-width').value = this.currentStyles.minorRoad.width;
        document.getElementById('minor-road-width-value').textContent = this.currentStyles.minorRoad.width;
        
        // Service roads
        document.getElementById('service-road-color').value = this.currentStyles.serviceRoad.color;
        document.getElementById('service-road-color-text').value = this.currentStyles.serviceRoad.color;
        document.getElementById('service-road-width').value = this.currentStyles.serviceRoad.width;
        document.getElementById('service-road-width-value').textContent = this.currentStyles.serviceRoad.width;
        
        // Building
        document.getElementById('building-fill-color').value = this.currentStyles.building.fillColor;
        document.getElementById('building-fill-color-text').value = this.currentStyles.building.fillColor;
        document.getElementById('building-fill-opacity').value = this.currentStyles.building.fillOpacity * 100;
        document.getElementById('building-fill-opacity-value').textContent = `${this.currentStyles.building.fillOpacity * 100}%`;
        document.getElementById('building-border-color').value = this.currentStyles.building.borderColor;
        document.getElementById('building-border-color-text').value = this.currentStyles.building.borderColor;
        
        // Special features
        document.getElementById('streetlight-color').value = this.currentStyles.streetlight.color;
        document.getElementById('streetlight-color-text').value = this.currentStyles.streetlight.color;
        document.getElementById('traffic-light-color').value = this.currentStyles.trafficLight.color;
        document.getElementById('traffic-light-color-text').value = this.currentStyles.trafficLight.color;
        
        // Street labels
        document.getElementById('street-label-size').value = this.currentStyles.streetLabel.fontSize;
        document.getElementById('street-label-size-value').textContent = `${this.currentStyles.streetLabel.fontSize}px`;
        document.getElementById('street-label-color').value = this.currentStyles.streetLabel.color;
        document.getElementById('street-label-color-text').value = this.currentStyles.streetLabel.color;
        document.getElementById('street-label-outline').value = this.currentStyles.streetLabel.outlineColor;
        document.getElementById('street-label-outline-text').value = this.currentStyles.streetLabel.outlineColor;
        document.getElementById('street-label-outline-width').value = this.currentStyles.streetLabel.outlineWidth;
        document.getElementById('street-label-outline-width-value').textContent = `${this.currentStyles.streetLabel.outlineWidth}px`;
        document.getElementById('street-label-repeat').value = this.currentStyles.streetLabel.repeat;
        document.getElementById('street-label-repeat-value').textContent = `${this.currentStyles.streetLabel.repeat}px`;
        document.getElementById('street-label-enabled').value = this.currentStyles.streetLabel.enabled.toString();
        document.getElementById('street-label-min-zoom').value = this.currentStyles.streetLabel.minZoom;
        document.getElementById('street-label-min-zoom-value').textContent = this.currentStyles.streetLabel.minZoom;
        document.getElementById('street-label-performance').value = this.currentStyles.streetLabel.performance;
        
        // Polygon labels
        document.getElementById('polygon-label-size').value = this.currentStyles.polygonLabel.fontSize;
        document.getElementById('polygon-label-size-value').textContent = `${this.currentStyles.polygonLabel.fontSize}px`;
        document.getElementById('polygon-label-color').value = this.currentStyles.polygonLabel.color;
        document.getElementById('polygon-label-color-text').value = this.currentStyles.polygonLabel.color;
        document.getElementById('polygon-label-outline').value = this.currentStyles.polygonLabel.outlineColor;
        document.getElementById('polygon-label-outline-text').value = this.currentStyles.polygonLabel.outlineColor;
        document.getElementById('polygon-label-min-zoom').value = this.currentStyles.polygonLabel.minZoom;
        document.getElementById('polygon-label-min-zoom-value').textContent = this.currentStyles.polygonLabel.minZoom;
        document.getElementById('polygon-icon-enabled').value = this.currentStyles.polygonLabel.iconEnabled.toString();
        document.getElementById('polygon-icon-size').value = this.currentStyles.polygonLabel.iconSize;
        document.getElementById('polygon-icon-size-value').textContent = `${this.currentStyles.polygonLabel.iconSize}px`;
        document.getElementById('polygon-min-scale').value = this.currentStyles.polygonLabel.minScale;
        document.getElementById('polygon-min-scale-value').textContent = this.currentStyles.polygonLabel.minScale;
    }
    
    applyStyles() {
        // Store styles in localStorage for the main map to use
        localStorage.setItem('mapStyles', JSON.stringify(this.currentStyles));
        this.showStatus('Styles applied successfully! Return to the map to see changes.', 'success');
        
        // If the main window exists, trigger a style update
        if (window.opener && window.opener.updateMapStyles) {
            window.opener.updateMapStyles(this.currentStyles);
        }
    }
    
    saveStyles() {
        localStorage.setItem('mapStyles', JSON.stringify(this.currentStyles));
        this.showStatus('Styles saved successfully!', 'success');
    }
    
    resetStyles() {
        this.currentStyles = JSON.parse(JSON.stringify(this.defaultStyles));
        this.syncInputValues();
        this.updateAllPreviews();
        this.showStatus('Styles reset to defaults', 'success');
    }
    
    loadStoredStyles() {
        const storedStyles = localStorage.getItem('mapStyles');
        if (storedStyles) {
            try {
                const parsed = JSON.parse(storedStyles);
                this.currentStyles = { ...this.defaultStyles, ...parsed };
            } catch (e) {
                console.error('Error loading stored styles:', e);
            }
        }
    }
    
    exportConfig() {
        const config = {
            version: '1.0',
            styles: this.currentStyles,
            exportDate: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'map-styles-config.json';
        a.click();
        URL.revokeObjectURL(url);
        
        this.showStatus('Configuration exported successfully!', 'success');
    }
    
    importConfig(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const config = JSON.parse(e.target.result);
                if (config.styles) {
                    this.currentStyles = { ...this.defaultStyles, ...config.styles };
                    this.syncInputValues();
                    this.updateAllPreviews();
                    this.showStatus('Configuration imported successfully!', 'success');
                } else {
                    this.showStatus('Invalid configuration file format', 'error');
                }
            } catch (err) {
                this.showStatus('Error reading configuration file', 'error');
                console.error('Import error:', err);
            }
        };
        reader.readAsText(file);
        
        // Reset the input
        event.target.value = '';
    }
    
    showStatus(message, type) {
        const statusEl = document.getElementById('status-message');
        statusEl.textContent = message;
        statusEl.className = `status-message status-${type}`;
        statusEl.style.display = 'block';
        
        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 3000);
    }
    
    isValidColor(color) {
        const s = new Option().style;
        s.color = color;
        return s.color !== '';
    }
    
    addOpacityToColor(color, opacity) {
        if (color.startsWith('#')) {
            const r = parseInt(color.slice(1, 3), 16);
            const g = parseInt(color.slice(3, 5), 16);
            const b = parseInt(color.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${opacity})`;
        }
        return color;
    }
}

// Initialize the style configurator when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new StyleConfigurator();
});