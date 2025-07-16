/**
 * Label Collision Manager
 * Handles collision detection and label prioritization for smooth map display
 */

class LabelCollisionManager {
    constructor() {
        this.labelBounds = new Map(); // Store label bounding boxes
        this.visibleLabels = new Set(); // Track which labels are visible
        this.gridSize = 100; // Grid cell size for spatial indexing
        this.spatialGrid = new Map(); // Spatial grid for efficient collision detection
        this.labelGroups = new Map(); // Store grouped labels
        this.processedLabels = new Set(); // Track which labels have been processed for grouping
    }

    /**
     * Clear all collision data for new frame
     */
    clearFrame() {
        this.labelBounds.clear();
        this.visibleLabels.clear();
        this.spatialGrid.clear();
        this.labelGroups.clear();
        this.processedLabels.clear();
    }

    /**
     * Check if a label can be displayed without collision
     */
    canDisplayLabel(feature, labelText, labelCenter, priority = 1, minDistance = 60) {
        const featureId = feature.getId() || feature.ol_uid;
        
        // Validate input coordinates
        if (!labelCenter || typeof labelCenter.x !== 'number' || typeof labelCenter.y !== 'number') {
            console.log(`Invalid coordinates for feature ${featureId}:`, labelCenter);
            return false;
        }
        
        // Simple distance-based collision detection
        for (const [existingId, existingBounds] of this.labelBounds) {
            if (existingId === featureId) continue;
            
            // Calculate distance between centers
            const existingCenter = {
                x: (existingBounds.left + existingBounds.right) / 2,
                y: (existingBounds.top + existingBounds.bottom) / 2
            };
            
            const distance = Math.sqrt(
                Math.pow(labelCenter.x - existingCenter.x, 2) + 
                Math.pow(labelCenter.y - existingCenter.y, 2)
            );
            
            if (distance < minDistance) {
                console.log(`Distance collision: ${distance.toFixed(1)} < ${minDistance} between "${labelText}" and existing label`);
                return false;
            }
        }
        
        // Register this label as visible with calculated bounds
        const bounds = this.calculateLabelBounds(labelCenter, labelText);
        this.registerLabel(featureId, bounds, priority);
        console.log(`✅ Registered label "${labelText}" at distance checks. Total visible: ${this.visibleLabels.size}`);
        return true;
    }

    /**
     * Calculate screen-space bounding box for label
     */
    calculateLabelBounds(center, text) {
        const fontSize = 14; // Default font size
        const charWidth = fontSize * 0.6; // Average character width
        const lineHeight = fontSize * 1.2; // Line height

        const lines = text.split('\n');
        const maxLineLength = Math.max(...lines.map(line => line.length));
        
        const width = maxLineLength * charWidth;
        const height = lines.length * lineHeight;
        
        // Add padding to prevent labels from being too close
        const padding = 8;
        
        return {
            left: center.x - width / 2 - padding,
            right: center.x + width / 2 + padding,
            top: center.y - height / 2 - padding,
            bottom: center.y + height / 2 + padding,
            width: width + padding * 2,
            height: height + padding * 2
        };
    }

    /**
     * Check if bounds collide with any existing visible labels
     */
    hasCollision(bounds, excludeId) {
        // Get grid cells that this label overlaps
        const gridCells = this.getOverlappingGridCells(bounds);
        
        for (const cellKey of gridCells) {
            const labelsInCell = this.spatialGrid.get(cellKey) || [];
            
            for (const labelId of labelsInCell) {
                if (labelId === excludeId) continue;
                
                const existingBounds = this.labelBounds.get(labelId);
                if (existingBounds && this.boundsOverlap(bounds, existingBounds)) {
                    return true;
                }
            }
        }
        
        return false;
    }

    /**
     * Register a label as visible in the collision system
     */
    registerLabel(featureId, bounds, priority) {
        this.labelBounds.set(featureId, bounds);
        this.visibleLabels.add(featureId);
        
        // Add to spatial grid
        const gridCells = this.getOverlappingGridCells(bounds);
        for (const cellKey of gridCells) {
            if (!this.spatialGrid.has(cellKey)) {
                this.spatialGrid.set(cellKey, []);
            }
            this.spatialGrid.get(cellKey).push(featureId);
        }
    }

    /**
     * Get grid cell keys that bounds overlap with
     */
    getOverlappingGridCells(bounds) {
        const cells = [];
        const startX = Math.floor(bounds.left / this.gridSize);
        const endX = Math.floor(bounds.right / this.gridSize);
        const startY = Math.floor(bounds.top / this.gridSize);
        const endY = Math.floor(bounds.bottom / this.gridSize);
        
        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                cells.push(`${x},${y}`);
            }
        }
        
        return cells;
    }

    /**
     * Check if two bounding boxes overlap
     */
    boundsOverlap(bounds1, bounds2) {
        return !(bounds1.right < bounds2.left || 
                bounds1.left > bounds2.right || 
                bounds1.bottom < bounds2.top || 
                bounds1.top > bounds2.bottom);
    }

    /**
     * Get priority for a feature (higher priority labels show first)
     */
    getFeaturePriority(feature, zoom) {
        const properties = feature.get('properties') || {};
        const geometryType = feature.getGeometry().getType();
        
        let priority = 1;
        
        // Higher priority for user-created features
        const isUserCreated = !properties.feature_type || !properties.source;
        if (isUserCreated) {
            priority += 10;
        }
        
        // Higher priority for larger polygons
        if (geometryType === 'Polygon') {
            const extent = feature.getGeometry().getExtent();
            const area = (extent[2] - extent[0]) * (extent[3] - extent[1]);
            priority += Math.min(area * 1000000, 5); // Scale area to reasonable priority range
        }
        
        // Higher priority at higher zoom levels
        priority += zoom * 0.1;
        
        return priority;
    }

    /**
     * Convert map coordinates to screen coordinates
     */
    mapToScreen(coordinate, map) {
        return map.getPixelFromCoordinate(coordinate);
    }

    /**
     * Get center point of a polygon feature
     */
    getPolygonCenter(feature, map) {
        const geometry = feature.getGeometry();
        const extent = geometry.getExtent();
        const center = [
            (extent[0] + extent[2]) / 2,
            (extent[1] + extent[3]) / 2
        ];
        return this.mapToScreen(center, map);
    }
}

// Global instance
window.LabelCollisionManager = LabelCollisionManager;