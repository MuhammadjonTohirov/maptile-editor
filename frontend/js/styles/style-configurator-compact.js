/**
 * Compact Style Configurator
 * Handles the new tabbed interface for style configuration
 */

class CompactStyleConfigurator {
    constructor() {
        this.defaultStyles = {
            point: { color: '#3399CC', radius: 8, borderColor: '#ffffff', borderWidth: 2 },
            line: { color: '#ff6b35', width: 3 },
            polygon: { fillColor: '#ff6b35', fillOpacity: 0.2, borderColor: '#ff6b35', borderWidth: 2 },
            road: { color: '#555555', width: 4, serviceRoadMinZoom: 15 },
            footway: { color: '#8B4513', width: 2, minZoom: 16, enabled: true },
            minorRoad: { color: '#999999', width: 1.5 },
            serviceRoad: { color: '#CCCCCC', width: 1 },
            
            // Polygon categories
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
                minZoom: 16,
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
        this.syncInputValues();
    }
    
    setupEventListeners() {
        // Basic Styles Tab
        this.setupColorInput('point-color', 'point-color-text', 'point', 'color');
        this.setupRangeInput('point-radius', 'point-radius-value', 'point', 'radius', (val) => parseInt(val), (val) => `${val}px`);
        
        this.setupColorInput('line-color', 'line-color-text', 'line', 'color');
        this.setupRangeInput('line-width', 'line-width-value', 'line', 'width', (val) => parseInt(val), (val) => `${val}px`);
        
        this.setupColorInput('polygon-fill-color', 'polygon-fill-color-text', 'polygon', 'fillColor');
        this.setupRangeInput('polygon-fill-opacity', 'polygon-fill-opacity-value', 'polygon', 'fillOpacity', (val) => val / 100, (val) => `${val}%`);
        
        // Polygon Categories Tab
        this.setupColorInput('building-fill-color', 'building-fill-color-text', 'building', 'fillColor');
        this.setupRangeInput('building-fill-opacity', 'building-fill-opacity-value', 'building', 'fillOpacity', (val) => val / 100, (val) => `${val}%`);
        
        this.setupColorInput('landuse-fill-color', 'landuse-fill-color-text', 'landuse', 'fillColor');
        this.setupRangeInput('landuse-fill-opacity', 'landuse-fill-opacity-value', 'landuse', 'fillOpacity', (val) => val / 100, (val) => `${val}%`);
        
        this.setupColorInput('natural-fill-color', 'natural-fill-color-text', 'natural', 'fillColor');
        this.setupRangeInput('natural-fill-opacity', 'natural-fill-opacity-value', 'natural', 'fillOpacity', (val) => val / 100, (val) => `${val}%`);
        
        this.setupColorInput('leisure-fill-color', 'leisure-fill-color-text', 'leisure', 'fillColor');
        this.setupRangeInput('leisure-fill-opacity', 'leisure-fill-opacity-value', 'leisure', 'fillOpacity', (val) => val / 100, (val) => `${val}%`);
        
        this.setupColorInput('amenity-fill-color', 'amenity-fill-color-text', 'amenity', 'fillColor');
        this.setupRangeInput('amenity-fill-opacity', 'amenity-fill-opacity-value', 'amenity', 'fillOpacity', (val) => val / 100, (val) => `${val}%`);
        
        this.setupColorInput('water-fill-color', 'water-fill-color-text', 'water', 'fillColor');
        this.setupRangeInput('water-fill-opacity', 'water-fill-opacity-value', 'water', 'fillOpacity', (val) => val / 100, (val) => `${val}%`);
        
        // Roads & Transport Tab
        this.setupColorInput('road-color', 'road-color-text', 'road', 'color');
        this.setupRangeInput('road-width', 'road-width-value', 'road', 'width', (val) => parseInt(val), (val) => `${val}px`);
        
        this.setupColorInput('footway-color', 'footway-color-text', 'footway', 'color');
        this.setupRangeInput('footway-width', 'footway-width-value', 'footway', 'width', (val) => parseInt(val), (val) => `${val}px`);
        this.setupRangeInput('footway-min-zoom', 'footway-min-zoom-value', 'footway', 'minZoom', (val) => parseInt(val));
        this.setupCheckboxInput('footway-enabled', 'footway', 'enabled');
        
        // Labels & Text Tab
        this.setupRangeInput('street-label-size', 'street-label-size-value', 'streetLabel', 'fontSize', (val) => parseInt(val), (val) => `${val}px`);
        this.setupRangeInput('street-label-min-zoom', 'street-label-min-zoom-value', 'streetLabel', 'minZoom', (val) => parseInt(val));
        this.setupCheckboxInput('street-label-enabled', 'streetLabel', 'enabled');
        this.setupSelectInput('street-label-performance', 'streetLabel', 'performance');
        
        this.setupRangeInput('polygon-label-size', 'polygon-label-size-value', 'polygonLabel', 'fontSize', (val) => parseInt(val), (val) => `${val}px`);
        this.setupRangeInput('polygon-label-min-zoom', 'polygon-label-min-zoom-value', 'polygonLabel', 'minZoom', (val) => parseInt(val));
        
        // Action buttons
        document.getElementById('apply-styles').addEventListener('click', () => this.applyStyles());
        document.getElementById('save-styles').addEventListener('click', () => this.saveStyles());
        document.getElementById('reset-styles').addEventListener('click', () => this.resetStyles());
    }
    
    setupColorInput(colorId, textId, category, property) {
        const colorInput = document.getElementById(colorId);
        const textInput = document.getElementById(textId);
        
        if (!colorInput || !textInput) return;
        
        const updateColor = (value) => {
            this.currentStyles[category][property] = value;
            colorInput.value = value;
            textInput.value = value;
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
        
        if (!rangeInput || !valueDisplay) return;
        
        rangeInput.addEventListener('input', (e) => {
            const value = transform(e.target.value);
            this.currentStyles[category][property] = value;
            valueDisplay.textContent = displayTransform(value);
        });
    }
    
    setupCheckboxInput(checkboxId, category, property) {
        const checkbox = document.getElementById(checkboxId);
        
        if (!checkbox) return;
        
        checkbox.addEventListener('change', (e) => {
            this.currentStyles[category][property] = e.target.checked;
        });
    }
    
    setupSelectInput(selectId, category, property) {
        const select = document.getElementById(selectId);
        
        if (!select) return;
        
        select.addEventListener('change', (e) => {
            this.currentStyles[category][property] = e.target.value;
        });
    }
    
    syncInputValues() {
        // Basic styles
        this.syncInput('point-color', this.currentStyles.point.color);
        this.syncInput('point-color-text', this.currentStyles.point.color);
        this.syncInput('point-radius', this.currentStyles.point.radius);
        this.syncDisplay('point-radius-value', `${this.currentStyles.point.radius}px`);
        
        this.syncInput('line-color', this.currentStyles.line.color);
        this.syncInput('line-color-text', this.currentStyles.line.color);
        this.syncInput('line-width', this.currentStyles.line.width);
        this.syncDisplay('line-width-value', `${this.currentStyles.line.width}px`);
        
        this.syncInput('polygon-fill-color', this.currentStyles.polygon.fillColor);
        this.syncInput('polygon-fill-color-text', this.currentStyles.polygon.fillColor);
        this.syncInput('polygon-fill-opacity', this.currentStyles.polygon.fillOpacity * 100);
        this.syncDisplay('polygon-fill-opacity-value', `${this.currentStyles.polygon.fillOpacity * 100}%`);
        
        // Polygon categories
        this.syncInput('building-fill-color', this.currentStyles.building.fillColor);
        this.syncInput('building-fill-color-text', this.currentStyles.building.fillColor);
        this.syncInput('building-fill-opacity', this.currentStyles.building.fillOpacity * 100);
        this.syncDisplay('building-fill-opacity-value', `${this.currentStyles.building.fillOpacity * 100}%`);
        
        this.syncInput('landuse-fill-color', this.currentStyles.landuse.fillColor);
        this.syncInput('landuse-fill-color-text', this.currentStyles.landuse.fillColor);
        this.syncInput('landuse-fill-opacity', this.currentStyles.landuse.fillOpacity * 100);
        this.syncDisplay('landuse-fill-opacity-value', `${this.currentStyles.landuse.fillOpacity * 100}%`);
        
        this.syncInput('natural-fill-color', this.currentStyles.natural.fillColor);
        this.syncInput('natural-fill-color-text', this.currentStyles.natural.fillColor);
        this.syncInput('natural-fill-opacity', this.currentStyles.natural.fillOpacity * 100);
        this.syncDisplay('natural-fill-opacity-value', `${this.currentStyles.natural.fillOpacity * 100}%`);
        
        this.syncInput('leisure-fill-color', this.currentStyles.leisure.fillColor);
        this.syncInput('leisure-fill-color-text', this.currentStyles.leisure.fillColor);
        this.syncInput('leisure-fill-opacity', this.currentStyles.leisure.fillOpacity * 100);
        this.syncDisplay('leisure-fill-opacity-value', `${this.currentStyles.leisure.fillOpacity * 100}%`);
        
        this.syncInput('amenity-fill-color', this.currentStyles.amenity.fillColor);
        this.syncInput('amenity-fill-color-text', this.currentStyles.amenity.fillColor);
        this.syncInput('amenity-fill-opacity', this.currentStyles.amenity.fillOpacity * 100);
        this.syncDisplay('amenity-fill-opacity-value', `${this.currentStyles.amenity.fillOpacity * 100}%`);
        
        this.syncInput('water-fill-color', this.currentStyles.water.fillColor);
        this.syncInput('water-fill-color-text', this.currentStyles.water.fillColor);
        this.syncInput('water-fill-opacity', this.currentStyles.water.fillOpacity * 100);
        this.syncDisplay('water-fill-opacity-value', `${this.currentStyles.water.fillOpacity * 100}%`);
        
        // Roads & Transport
        this.syncInput('road-color', this.currentStyles.road.color);
        this.syncInput('road-color-text', this.currentStyles.road.color);
        this.syncInput('road-width', this.currentStyles.road.width);
        this.syncDisplay('road-width-value', `${this.currentStyles.road.width}px`);
        
        this.syncInput('footway-color', this.currentStyles.footway.color);
        this.syncInput('footway-color-text', this.currentStyles.footway.color);
        this.syncInput('footway-width', this.currentStyles.footway.width);
        this.syncDisplay('footway-width-value', `${this.currentStyles.footway.width}px`);
        this.syncInput('footway-min-zoom', this.currentStyles.footway.minZoom);
        this.syncDisplay('footway-min-zoom-value', this.currentStyles.footway.minZoom);
        this.syncInput('footway-enabled', this.currentStyles.footway.enabled, 'checked');
        
        // Labels & Text
        this.syncInput('street-label-size', this.currentStyles.streetLabel.fontSize);
        this.syncDisplay('street-label-size-value', `${this.currentStyles.streetLabel.fontSize}px`);
        this.syncInput('street-label-min-zoom', this.currentStyles.streetLabel.minZoom);
        this.syncDisplay('street-label-min-zoom-value', this.currentStyles.streetLabel.minZoom);
        this.syncInput('street-label-enabled', this.currentStyles.streetLabel.enabled, 'checked');
        this.syncInput('street-label-performance', this.currentStyles.streetLabel.performance);
        
        this.syncInput('polygon-label-size', this.currentStyles.polygonLabel.fontSize);
        this.syncDisplay('polygon-label-size-value', `${this.currentStyles.polygonLabel.fontSize}px`);
        this.syncInput('polygon-label-min-zoom', this.currentStyles.polygonLabel.minZoom);
        this.syncDisplay('polygon-label-min-zoom-value', this.currentStyles.polygonLabel.minZoom);
    }
    
    syncInput(elementId, value, property = 'value') {
        const element = document.getElementById(elementId);
        if (element) {
            element[property] = value;
        }
    }
    
    syncDisplay(elementId, text) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = text;
        }
    }
    
    applyStyles() {
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
        this.showStatus('Styles reset to defaults', 'success');
    }
    
    loadStoredStyles() {
        const storedStyles = localStorage.getItem('mapStyles');
        if (storedStyles) {
            try {
                const parsed = JSON.parse(storedStyles);
                this.currentStyles = { ...this.defaultStyles, ...parsed };
                
                // Ensure all polygon categories exist
                const polygonCategories = ['building', 'landuse', 'natural', 'leisure', 'amenity', 'transportation', 'water', 'sport', 'utility'];
                polygonCategories.forEach(category => {
                    if (!this.currentStyles[category]) {
                        this.currentStyles[category] = this.defaultStyles[category];
                    } else {
                        this.currentStyles[category] = { ...this.defaultStyles[category], ...this.currentStyles[category] };
                    }
                });
                
                // Ensure labels exist
                if (!this.currentStyles.streetLabel) {
                    this.currentStyles.streetLabel = this.defaultStyles.streetLabel;
                } else {
                    this.currentStyles.streetLabel = { ...this.defaultStyles.streetLabel, ...this.currentStyles.streetLabel };
                }
                
                if (!this.currentStyles.polygonLabel) {
                    this.currentStyles.polygonLabel = this.defaultStyles.polygonLabel;
                } else {
                    this.currentStyles.polygonLabel = { ...this.defaultStyles.polygonLabel, ...this.currentStyles.polygonLabel };
                }
            } catch (e) {
                console.error('Error loading stored styles:', e);
            }
        }
    }
    
    showStatus(message, type) {
        const statusEl = document.getElementById('status-message');
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.className = `status-message status-${type}`;
            statusEl.style.display = 'block';
            
            setTimeout(() => {
                statusEl.style.display = 'none';
            }, 3000);
        }
    }
    
    isValidColor(color) {
        const s = new Option().style;
        s.color = color;
        return s.color !== '';
    }
}

// Initialize the compact style configurator when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new CompactStyleConfigurator();
});