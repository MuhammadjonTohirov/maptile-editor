/**
 * Dynamic Feature Loader
 * Replaces bulk loading with progressive, viewport-based feature loading
 */

class DynamicFeatureLoader {
    constructor(mapCore, featureManager) {
        this.mapCore = mapCore;
        this.featureManager = featureManager;
        this.cacheManager = new FeatureCacheManager();
        
        this.isLoading = false;
        this.lastLoadBounds = null;
        this.lastLoadZoom = null;
        this.loadDebounceTimer = null;
        this.loadDebounceDelay = 300; // ms
        
        console.log('🔄 Dynamic feature loader initialized');
        console.log('🗺️ Map core:', this.mapCore);
        console.log('📊 Feature manager:', this.featureManager);
        
        this.setupViewportChangeListener();
        this.setupInitialLoad();
    }
    
    /**
     * Setup listener for viewport changes (pan/zoom)
     */
    setupViewportChangeListener() {
        const view = this.mapCore.map.getView();
        
        // Listen for view changes (pan/zoom)
        view.on('change:center', () => this.onViewportChange());
        view.on('change:resolution', () => this.onViewportChange());
        
        // Also listen for moveend events (when user stops dragging)
        this.mapCore.map.on('moveend', () => {
            console.log('🗺️ Map moveend event detected');
            this.onViewportChange();
        });
        
    }
    
    /**
     * Setup initial feature loading with multiple strategies
     */
    setupInitialLoad() {
        console.log('🎯 Setting up initial feature loading...');
        
        // Strategy 1: Immediate attempt
        this.tryInitialLoad('immediate', 500);
        
        // Strategy 2: Wait for map to be fully rendered
        this.mapCore.map.once('rendercomplete', () => {
            console.log('🗺️ Map render complete, loading features...');
            this.tryInitialLoad('rendercomplete', 100);
        });
        
        // Strategy 3: Wait for map view to be ready
        this.mapCore.map.once('postrender', () => {
            console.log('🖼️ Map post-render complete, loading features...');
            this.tryInitialLoad('postrender', 200);
        });
        
        // Strategy 4: Backup timers
        this.tryInitialLoad('backup1', 2000);
        this.tryInitialLoad('backup2', 4000);
        
        // Strategy 5: Manual trigger from global scope
        window.triggerManualLoad = () => {
            console.log('🔧 Manual trigger activated');
            this.loadFeaturesForCurrentViewport(true);
        };
    }
    
    /**
     * Try to load features with a delay
     */
    tryInitialLoad(strategy, delay) {
        setTimeout(() => {
            console.log(`🎯 Trying initial load (${strategy})...`);
            
            // Check if map is ready
            const view = this.mapCore.map.getView();
            const center = view.getCenter();
            const zoom = view.getZoom();
            
            if (center && zoom) {
                console.log(`✅ Map ready (${strategy}), loading features...`);
                this.loadFeaturesForCurrentViewport(true);
            } else {
                console.log(`⏳ Map not ready yet (${strategy})`);
            }
        }, delay);
    }
    
    /**
     * Handle viewport changes with debouncing
     */
    onViewportChange() {
        console.log('🔄 Viewport change detected, debouncing...');
        
        // Clear existing timer
        if (this.loadDebounceTimer) {
            clearTimeout(this.loadDebounceTimer);
        }
        
        // Set new timer
        this.loadDebounceTimer = setTimeout(() => {
            console.log('⏰ Debounce timer expired, checking if load needed...');
            this.loadFeaturesForCurrentViewport();
        }, this.loadDebounceDelay);
    }
    
    /**
     * Load features for current viewport
     */
    async loadFeaturesForCurrentViewport(forceRefresh = false) {
        if (this.isLoading && !forceRefresh) {
            console.log('⏳ Already loading features, skipping...');
            return;
        }
        
        try {
            this.isLoading = true;
            
            // Get current viewport bounds and zoom
            const bounds = GeometryUtils.getMapBounds(this.mapCore.map);
            const zoom = Math.round(this.mapCore.map.getView().getZoom());
            
            console.log(`📍 Current viewport: zoom=${zoom}, bounds=`, bounds);
            
            // Skip if viewport hasn't changed significantly
            if (!forceRefresh && !this.hasViewportChangedSignificantly(bounds, zoom)) {
                console.log('📍 Viewport unchanged, skipping load');
                this.isLoading = false;
                return;
            }
            
            console.log(`🔄 Loading features for viewport (zoom: ${zoom}), force=${forceRefresh}`);
            
            // Update last load state
            this.lastLoadBounds = bounds;
            this.lastLoadZoom = zoom;
            
            // Get features from cache or server
            const features = await this.cacheManager.getFeaturesForViewport(bounds, zoom, forceRefresh);
            
            // Update map with loaded features
            console.log(`📊 Current features on map: ${this.mapCore.vectorSource.getFeatures().length}`);
            await this.updateMapWithFeatures(features);
            console.log(`📊 Features on map after update: ${this.mapCore.vectorSource.getFeatures().length}`);
            
            console.log(`✅ Loaded ${features.length} features for current viewport`);
            
        } catch (error) {
            console.error('❌ Error loading features for viewport:', error);
            // Don't show alert for background loading errors
        } finally {
            this.isLoading = false;
        }
    }
    
    /**
     * Check if viewport has changed significantly enough to warrant reloading
     */
    hasViewportChangedSignificantly(bounds, zoom) {
        if (!this.lastLoadBounds || !this.lastLoadZoom) {
            return true; // First load
        }
        
        // Check zoom change - trigger on any zoom change
        if (Math.abs(zoom - this.lastLoadZoom) >= 0.5) {
            console.log(`🔍 Zoom changed significantly: ${this.lastLoadZoom} → ${zoom}`);
            return true;
        }
        
        // Check if viewport moved significantly (>15% of current view)
        const currentWidth = bounds.east - bounds.west;
        const currentHeight = bounds.north - bounds.south;
        const threshold = 0.15; // Reduced from 0.25 to trigger more easily
        
        const centerXDiff = Math.abs((bounds.east + bounds.west) / 2 - (this.lastLoadBounds.east + this.lastLoadBounds.west) / 2);
        const centerYDiff = Math.abs((bounds.north + bounds.south) / 2 - (this.lastLoadBounds.north + this.lastLoadBounds.south) / 2);
        
        const xThreshold = currentWidth * threshold;
        const yThreshold = currentHeight * threshold;
        const significantChange = centerXDiff > xThreshold || centerYDiff > yThreshold;
        
        console.log(`📊 Viewport change analysis:
            - Zoom change: ${Math.abs(zoom - this.lastLoadZoom)}
            - X movement: ${centerXDiff.toFixed(6)} (threshold: ${xThreshold.toFixed(6)})
            - Y movement: ${centerYDiff.toFixed(6)} (threshold: ${yThreshold.toFixed(6)})
            - Significant change: ${significantChange}`);
        
        return significantChange;
    }
    
    /**
     * Update map with new features (merge with existing)
     */
    async updateMapWithFeatures(features) {
        const existingFeatureIds = new Set();
        
        // Get existing feature IDs
        this.mapCore.vectorSource.getFeatures().forEach(feature => {
            const id = feature.getId();
            if (id) existingFeatureIds.add(id);
        });
        
        // Add new features
        let newFeatures = 0;
        for (const featureData of features) {
            if (!featureData.id || existingFeatureIds.has(featureData.id)) {
                continue; // Skip if already exists
            }
            
            try {
                const olFeature = GeometryUtils.geoJSONToOLFeature(featureData);
                if (!olFeature) continue;
                
                // Set feature properties
                olFeature.setId(featureData.id);
                olFeature.set('name', featureData.properties?.name || '');
                olFeature.set('description', featureData.properties?.description || '');
                olFeature.set('building_number', featureData.properties?.building_number || '');
                olFeature.set('building_type', featureData.properties?.building_type || '');
                olFeature.set('icon', featureData.properties?.icon || '');
                olFeature.set('properties', featureData.properties || {});
                
                // Add to map
                this.mapCore.vectorSource.addFeature(olFeature);
                this.mapCore.features.set(featureData.id, olFeature);
                newFeatures++;
                
            } catch (error) {
                console.error('Error creating feature:', error);
            }
        }
        
        // Temporarily disable cleanup to avoid clearing features during zoom
        // this.cleanupDistantFeatures();
        
        if (newFeatures > 0) {
            console.log(`🆕 Added ${newFeatures} new features to map`);
        }
    }
    
    /**
     * Remove features that are far from current viewport to save memory
     */
    cleanupDistantFeatures() {
        const zoom = this.mapCore.map.getView().getZoom();
        
        // Only cleanup at higher zoom levels (more features loaded)
        if (zoom < 16) return;
        
        const bounds = GeometryUtils.getMapBounds(this.mapCore.map);
        const cleanupBuffer = 0.02; // Remove features >2x viewport away
        const expandedBounds = this.cacheManager.expandBounds(bounds, cleanupBuffer);
        
        const featuresToRemove = [];
        
        this.mapCore.vectorSource.getFeatures().forEach(feature => {
            const geometry = feature.getGeometry();
            if (!geometry) return;
            
            // Check if feature is outside cleanup bounds
            const coords = this.getFeatureCoordinates(feature);
            if (coords && !this.pointInBounds(coords[0], coords[1], expandedBounds)) {
                // Don't remove user-created features (temp IDs)
                const id = feature.getId();
                if (id && !GeometryUtils.isTempId(id)) {
                    featuresToRemove.push(feature);
                }
            }
        });
        
        // Remove distant features
        featuresToRemove.forEach(feature => {
            this.mapCore.vectorSource.removeFeature(feature);
            const id = feature.getId();
            if (id) {
                this.mapCore.features.delete(id);
            }
        });
        
        if (featuresToRemove.length > 0) {
            console.log(`🧹 Cleaned up ${featuresToRemove.length} distant features`);
        }
    }
    
    /**
     * Get representative coordinates for a feature
     */
    getFeatureCoordinates(feature) {
        const geometry = feature.getGeometry();
        const type = geometry.getType();
        
        if (type === 'Point') {
            return geometry.getCoordinates();
        } else if (type === 'LineString') {
            const coords = geometry.getCoordinates();
            return coords[Math.floor(coords.length / 2)]; // Middle point
        } else if (type === 'Polygon') {
            const extent = geometry.getExtent();
            return [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2]; // Center
        }
        
        return null;
    }
    
    /**
     * Check if point is within bounds
     */
    pointInBounds(lon, lat, bounds) {
        return lon >= bounds.west && lon <= bounds.east && 
               lat >= bounds.south && lat <= bounds.north;
    }
    
    /**
     * Force refresh of current viewport
     */
    async refreshCurrentViewport() {
        console.log('🔄 Force refreshing current viewport...');
        await this.loadFeaturesForCurrentViewport(true);
    }
    
    /**
     * Clear all cached data and reload
     */
    async clearCacheAndReload() {
        console.log('🗑️ Clearing cache and reloading...');
        this.cacheManager.clearCache();
        this.lastLoadBounds = null;
        this.lastLoadZoom = null;
        this.mapCore.vectorSource.clear();
        this.mapCore.features.clear();
        await this.loadFeaturesForCurrentViewport(true);
    }
    
    /**
     * Get cache statistics for debugging
     */
    getCacheStats() {
        return this.cacheManager.getCacheStats();
    }
    
    /**
     * Preload features for adjacent areas (optional optimization)
     */
    async preloadAdjacentAreas() {
        if (this.isLoading) return;
        
        const bounds = GeometryUtils.getMapBounds(this.mapCore.map);
        const zoom = Math.round(this.mapCore.map.getView().getZoom());
        
        // Only preload at medium-high zoom levels
        if (zoom < 15) return;
        
        const width = bounds.east - bounds.west;
        const height = bounds.north - bounds.south;
        
        // Preload adjacent tiles
        const adjacentBounds = [
            { west: bounds.east, east: bounds.east + width, south: bounds.south, north: bounds.north }, // Right
            { west: bounds.west - width, east: bounds.west, south: bounds.south, north: bounds.north }, // Left
            { west: bounds.west, east: bounds.east, south: bounds.north, north: bounds.north + height }, // Top
            { west: bounds.west, east: bounds.east, south: bounds.south - height, north: bounds.south }  // Bottom
        ];
        
        for (const adjBounds of adjacentBounds) {
            try {
                await this.cacheManager.getFeaturesForViewport(adjBounds, zoom);
            } catch (error) {
                // Ignore preload errors
            }
        }
    }
}

// Export for use in modules
window.DynamicFeatureLoader = DynamicFeatureLoader;