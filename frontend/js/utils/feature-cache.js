/**
 * Feature Cache Manager
 * Implements intelligent caching and dynamic loading for map features
 */

class FeatureCacheManager {
    constructor() {
        this.cache = new Map(); // Main feature cache
        this.spatialIndex = new Map(); // Spatial index for quick lookups
        this.loadedBounds = []; // Track loaded areas
        this.loadingPromises = new Map(); // Prevent duplicate requests
        this.maxCacheSize = 10000; // Maximum features to cache
        this.tileSize = 0.01; // Degrees (roughly 1km at equator)
        this.loadBuffer = 0.005; // Extra buffer around viewport
        
        // Performance settings
        this.minZoomForFeatures = 12;
        this.maxFeaturesPerTile = 500;
        this.cacheExpiryTime = 5 * 60 * 1000; // 5 minutes
        
        console.log('🗄️ Feature cache manager initialized');
        
        // Test basic functionality
        this.testBasicFunctionality();
    }
    
    /**
     * Get features for current viewport with caching
     */
    async getFeaturesForViewport(bounds, zoom, forceRefresh = false) {
        console.log(`🔍 Loading features for zoom ${zoom}, bounds:`, bounds);
        
        // Don't load features at very low zoom levels
        if (zoom < this.minZoomForFeatures) {
            console.log(`⏸️ Zoom ${zoom} too low, skipping feature load`);
            return [];
        }
        
        // Expand bounds with buffer
        const bufferedBounds = this.expandBounds(bounds, this.loadBuffer);
        
        // Check cache first
        if (!forceRefresh) {
            const cachedFeatures = this.getCachedFeatures(bufferedBounds);
            if (cachedFeatures.length > 0) {
                console.log(`✅ Cache hit: ${cachedFeatures.length} features`);
                return this.filterFeaturesByZoom(cachedFeatures, zoom);
            }
        }
        
        // Load features dynamically
        return await this.loadFeaturesForBounds(bufferedBounds, zoom);
    }
    
    /**
     * Load features for specific bounds
     */
    async loadFeaturesForBounds(bounds, zoom) {
        const boundsKey = this.getBoundsKey(bounds);
        
        // Check if already loading
        if (this.loadingPromises.has(boundsKey)) {
            console.log('⏳ Already loading this area, waiting...');
            return await this.loadingPromises.get(boundsKey);
        }
        
        // Create loading promise
        const loadingPromise = this.performFeatureLoad(bounds, zoom);
        this.loadingPromises.set(boundsKey, loadingPromise);
        
        try {
            const features = await loadingPromise;
            this.loadingPromises.delete(boundsKey);
            return features;
        } catch (error) {
            this.loadingPromises.delete(boundsKey);
            throw error;
        }
    }
    
    /**
     * Perform the actual feature loading
     */
    async performFeatureLoad(bounds, zoom) {
        try {
            console.log('📡 Fetching features from server...');
            
            // Call backend with spatial query
            let response;
            try {
                response = await fetch('/api/features/spatial', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        bounds: bounds,
                        zoom: zoom,
                        limit: this.maxFeaturesPerTile
                    })
                });
            } catch (error) {
                console.log('🔄 Spatial endpoint failed, using fallback');
                response = null;
            }
            
            if (!response || !response.ok) {
                // Fallback to existing endpoint if spatial endpoint doesn't exist
                console.log('🔄 Using /features endpoint as fallback');
                const fallbackResponse = await fetch('/api/features');
                if (!fallbackResponse.ok) {
                    throw new Error('Failed to load features from both endpoints');
                }
                const data = await fallbackResponse.json();
                const features = data.features || [];
                
                console.log(`📡 Fallback loaded ${features.length} total features, filtering to viewport...`);
                
                // Filter features to viewport
                const filteredFeatures = this.filterFeaturesToBounds(features, bounds);
                this.cacheFeatures(filteredFeatures, bounds);
                return this.filterFeaturesByZoom(filteredFeatures, zoom);
            }
            
            const data = await response.json();
            const features = data.features || [];
            
            // Cache the loaded features
            this.cacheFeatures(features, bounds);
            
            console.log(`✅ Loaded ${features.length} features for zoom ${zoom}`);
            return this.filterFeaturesByZoom(features, zoom);
            
        } catch (error) {
            console.error('❌ Error loading features:', error);
            
            // Try to return cached features as fallback
            const cachedFeatures = this.getCachedFeatures(bounds);
            if (cachedFeatures.length > 0) {
                console.log(`🔄 Using ${cachedFeatures.length} cached features as fallback`);
                return this.filterFeaturesByZoom(cachedFeatures, zoom);
            }
            
            throw error;
        }
    }
    
    /**
     * Cache features with spatial indexing
     */
    cacheFeatures(features, bounds) {
        const timestamp = Date.now();
        
        features.forEach(feature => {
            if (!feature.id) return;
            
            // Store in main cache
            this.cache.set(feature.id, {
                feature: feature,
                timestamp: timestamp,
                bounds: bounds
            });
            
            // Add to spatial index
            this.addToSpatialIndex(feature);
        });
        
        // Mark this area as loaded
        this.loadedBounds.push({
            bounds: bounds,
            timestamp: timestamp
        });
        
        // Clean old cache entries
        this.cleanCache();
        
        console.log(`🗄️ Cached ${features.length} features. Total in cache: ${this.cache.size}`);
    }
    
    /**
     * Add feature to spatial index
     */
    addToSpatialIndex(feature) {
        if (!feature.geometry || !feature.geometry.coordinates) return;
        
        const tileKeys = this.getFeatureTileKeys(feature);
        
        tileKeys.forEach(tileKey => {
            if (!this.spatialIndex.has(tileKey)) {
                this.spatialIndex.set(tileKey, new Set());
            }
            this.spatialIndex.get(tileKey).add(feature.id);
        });
    }
    
    /**
     * Get tile keys that this feature intersects
     */
    getFeatureTileKeys(feature) {
        const tileKeys = [];
        const geom = feature.geometry;
        
        if (geom.type === 'Point') {
            const [lon, lat] = geom.coordinates;
            tileKeys.push(this.getTileKey(lon, lat));
        } else if (geom.type === 'LineString') {
            geom.coordinates.forEach(([lon, lat]) => {
                tileKeys.push(this.getTileKey(lon, lat));
            });
        } else if (geom.type === 'Polygon') {
            // Sample points along polygon boundary
            const coords = geom.coordinates[0]; // Exterior ring
            for (let i = 0; i < coords.length; i += Math.max(1, Math.floor(coords.length / 10))) {
                const [lon, lat] = coords[i];
                tileKeys.push(this.getTileKey(lon, lat));
            }
        }
        
        return [...new Set(tileKeys)]; // Remove duplicates
    }
    
    /**
     * Get tile key for coordinates
     */
    getTileKey(lon, lat) {
        const tileX = Math.floor(lon / this.tileSize);
        const tileY = Math.floor(lat / this.tileSize);
        return `${tileX},${tileY}`;
    }
    
    /**
     * Get cached features for bounds
     */
    getCachedFeatures(bounds) {
        const tileKeys = this.getBoundsTileKeys(bounds);
        const featureIds = new Set();
        
        // Collect all feature IDs in the requested tiles
        tileKeys.forEach(tileKey => {
            const tileFeatures = this.spatialIndex.get(tileKey);
            if (tileFeatures) {
                tileFeatures.forEach(id => featureIds.add(id));
            }
        });
        
        // Get actual features from cache
        const features = [];
        featureIds.forEach(id => {
            const cached = this.cache.get(id);
            if (cached && !this.isCacheExpired(cached.timestamp)) {
                features.push(cached.feature);
            }
        });
        
        return features;
    }
    
    /**
     * Get tile keys for bounds
     */
    getBoundsTileKeys(bounds) {
        const tileKeys = [];
        const minTileX = Math.floor(bounds.west / this.tileSize);
        const maxTileX = Math.floor(bounds.east / this.tileSize);
        const minTileY = Math.floor(bounds.south / this.tileSize);
        const maxTileY = Math.floor(bounds.north / this.tileSize);
        
        for (let x = minTileX; x <= maxTileX; x++) {
            for (let y = minTileY; y <= maxTileY; y++) {
                tileKeys.push(`${x},${y}`);
            }
        }
        
        return tileKeys;
    }
    
    /**
     * Filter features by zoom level for performance
     */
    filterFeaturesByZoom(features, zoom) {
        // Be much less aggressive with zoom filtering to avoid clearing features
        if (zoom >= 14) {
            return features; // Show all features at zoom 14+
        }
        
        // Only at very low zoom levels, filter to major features only
        return features.filter(feature => {
            const props = feature.properties || {};
            
            // Always show major roads
            if (props.road_type && ['primary', 'secondary', 'trunk', 'motorway'].includes(props.road_type)) {
                return true;
            }
            
            // Show all buildings (don't filter by size)
            if (props.polygon_category === 'building') {
                return true;
            }
            
            // Show important amenities
            if (props.polygon_category === 'amenity') {
                return true;
            }
            
            // Show landuse, water, natural features
            if (props.polygon_category && ['landuse', 'water', 'natural'].includes(props.polygon_category)) {
                return true;
            }
            
            return true; // Default to showing features
        });
    }
    
    /**
     * Check if feature is geometrically large
     */
    isLargeFeature(feature) {
        if (!feature.geometry || feature.geometry.type !== 'Polygon') {
            return false;
        }
        
        const coords = feature.geometry.coordinates[0];
        if (coords.length < 4) return false;
        
        // Calculate approximate area
        let area = 0;
        for (let i = 0; i < coords.length - 1; i++) {
            const [x1, y1] = coords[i];
            const [x2, y2] = coords[i + 1];
            area += (x1 * y2 - x2 * y1);
        }
        area = Math.abs(area) / 2;
        
        // Consider "large" if area > 0.0001 square degrees (roughly 1000m²)
        return area > 0.0001;
    }
    
    /**
     * Filter features to specific bounds
     */
    filterFeaturesToBounds(features, bounds) {
        return features.filter(feature => {
            if (!feature.geometry || !feature.geometry.coordinates) return false;
            
            const geom = feature.geometry;
            
            if (geom.type === 'Point') {
                const [lon, lat] = geom.coordinates;
                return this.pointInBounds(lon, lat, bounds);
            } else if (geom.type === 'LineString') {
                return geom.coordinates.some(([lon, lat]) => this.pointInBounds(lon, lat, bounds));
            } else if (geom.type === 'Polygon') {
                const coords = geom.coordinates[0];
                return coords.some(([lon, lat]) => this.pointInBounds(lon, lat, bounds));
            }
            
            return false;
        });
    }
    
    /**
     * Check if point is within bounds
     */
    pointInBounds(lon, lat, bounds) {
        return lon >= bounds.west && lon <= bounds.east && 
               lat >= bounds.south && lat <= bounds.north;
    }
    
    /**
     * Expand bounds by buffer
     */
    expandBounds(bounds, buffer) {
        return {
            west: bounds.west - buffer,
            east: bounds.east + buffer,
            south: bounds.south - buffer,
            north: bounds.north + buffer
        };
    }
    
    /**
     * Generate unique key for bounds
     */
    getBoundsKey(bounds) {
        return `${bounds.west.toFixed(3)},${bounds.south.toFixed(3)},${bounds.east.toFixed(3)},${bounds.north.toFixed(3)}`;
    }
    
    /**
     * Check if cache entry is expired
     */
    isCacheExpired(timestamp) {
        return Date.now() - timestamp > this.cacheExpiryTime;
    }
    
    /**
     * Clean expired cache entries
     */
    cleanCache() {
        if (this.cache.size <= this.maxCacheSize) return;
        
        const now = Date.now();
        const toDelete = [];
        
        // Find expired or excess entries
        for (const [id, cached] of this.cache) {
            if (this.isCacheExpired(cached.timestamp) || toDelete.length > this.cache.size - this.maxCacheSize) {
                toDelete.push(id);
            }
        }
        
        // Remove from cache and spatial index
        toDelete.forEach(id => {
            const cached = this.cache.get(id);
            if (cached) {
                this.removeFromSpatialIndex(cached.feature);
                this.cache.delete(id);
            }
        });
        
        if (toDelete.length > 0) {
            console.log(`🧹 Cleaned ${toDelete.length} expired cache entries`);
        }
    }
    
    /**
     * Remove feature from spatial index
     */
    removeFromSpatialIndex(feature) {
        const tileKeys = this.getFeatureTileKeys(feature);
        tileKeys.forEach(tileKey => {
            const tileFeatures = this.spatialIndex.get(tileKey);
            if (tileFeatures) {
                tileFeatures.delete(feature.id);
                if (tileFeatures.size === 0) {
                    this.spatialIndex.delete(tileKey);
                }
            }
        });
    }
    
    /**
     * Clear all cache
     */
    clearCache() {
        this.cache.clear();
        this.spatialIndex.clear();
        this.loadedBounds = [];
        this.loadingPromises.clear();
        console.log('🗑️ Cache cleared');
    }
    
    /**
     * Get cache statistics
     */
    getCacheStats() {
        return {
            totalFeatures: this.cache.size,
            spatialTiles: this.spatialIndex.size,
            loadedAreas: this.loadedBounds.length,
            activeRequests: this.loadingPromises.size
        };
    }
    
    /**
     * Test basic functionality
     */
    testBasicFunctionality() {
        console.log('🧪 Testing cache manager...');
        
        // Test bounds key generation
        const testBounds = { west: -1, east: 1, south: -1, north: 1 };
        const key = this.getBoundsKey(testBounds);
        console.log('✅ Bounds key generation:', key);
        
        // Test tile key generation
        const tileKey = this.getTileKey(0, 0);
        console.log('✅ Tile key generation:', tileKey);
        
        console.log('✅ Cache manager basic test passed');
    }
}

// Global instance
window.FeatureCacheManager = FeatureCacheManager;