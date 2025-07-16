/**
 * Debug Tools for Dynamic Feature Loading
 * Add debugging capabilities to test the dynamic loading system
 */

// Wait for map to be ready
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (window.mapEditor && window.mapEditor.dynamicLoader) {
            
            // Create debug panel
            createDebugPanel();
            
            // Expose debug functions globally
            window.debugFeatureLoading = {
                // Force load current viewport
                loadNow: () => {
                    console.log('🔧 Debug: Force loading current viewport...');
                    window.mapEditor.dynamicLoader.loadFeaturesForCurrentViewport(true);
                },
                
                // Clear cache and reload
                clearAndReload: () => {
                    console.log('🔧 Debug: Clearing cache and reloading...');
                    window.mapEditor.dynamicLoader.clearCacheAndReload();
                },
                
                // Get cache stats
                getStats: () => {
                    const stats = window.mapEditor.dynamicLoader.getCacheStats();
                    console.log('📊 Cache stats:', stats);
                    return stats;
                },
                
                // Get current viewport info
                getViewport: () => {
                    const bounds = GeometryUtils.getMapBounds(window.mapEditor.map);
                    const zoom = window.mapEditor.map.getView().getZoom();
                    console.log('📍 Current viewport:', { bounds, zoom });
                    return { bounds, zoom };
                },
                
                // Test feature loading directly
                testLoad: async () => {
                    console.log('🧪 Testing direct feature load...');
                    try {
                        const bounds = GeometryUtils.getMapBounds(window.mapEditor.map);
                        const zoom = Math.round(window.mapEditor.map.getView().getZoom());
                        const cacheManager = window.mapEditor.dynamicLoader.cacheManager;
                        const features = await cacheManager.performFeatureLoad(bounds, zoom);
                        console.log('✅ Direct load successful:', features.length, 'features');
                        return features;
                    } catch (error) {
                        console.error('❌ Direct load failed:', error);
                        throw error;
                    }
                },
                
                // Simulate viewport change
                triggerViewportChange: () => {
                    console.log('🔧 Debug: Manually triggering viewport change...');
                    window.mapEditor.dynamicLoader.onViewportChange();
                },
                
                // Manual load trigger
                manualLoad: () => {
                    console.log('🔧 Debug: Manual load trigger...');
                    if (window.triggerManualLoad) {
                        window.triggerManualLoad();
                    } else {
                        console.log('❌ Manual load function not available');
                    }
                }
            };
            
            console.log('🔧 Debug tools loaded! Use window.debugFeatureLoading for testing');
            console.log('📘 Available commands:', Object.keys(window.debugFeatureLoading));
            
        } else {
            console.warn('⚠️ Debug tools: Map editor or dynamic loader not found');
        }
    }, 3000);
});

function createDebugPanel() {
    // Don't create if already exists
    if (document.getElementById('debug-panel')) return;
    
    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 10px;
        border-radius: 5px;
        font-family: monospace;
        font-size: 12px;
        z-index: 10000;
        min-width: 200px;
    `;
    
    panel.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 10px;">🔧 Debug Panel</div>
        <button onclick="window.debugFeatureLoading.loadNow()" style="display: block; width: 100%; margin: 2px 0; padding: 5px;">Load Now</button>
        <button onclick="window.debugFeatureLoading.clearAndReload()" style="display: block; width: 100%; margin: 2px 0; padding: 5px;">Clear & Reload</button>
        <button onclick="window.debugFeatureLoading.getStats()" style="display: block; width: 100%; margin: 2px 0; padding: 5px;">Cache Stats</button>
        <button onclick="window.debugFeatureLoading.getViewport()" style="display: block; width: 100%; margin: 2px 0; padding: 5px;">Viewport Info</button>
        <button onclick="window.debugFeatureLoading.testLoad()" style="display: block; width: 100%; margin: 2px 0; padding: 5px;">Test Direct Load</button>
        <button onclick="window.debugFeatureLoading.triggerViewportChange()" style="display: block; width: 100%; margin: 2px 0; padding: 5px;">Trigger Viewport Change</button>
        <button onclick="window.debugFeatureLoading.manualLoad()" style="display: block; width: 100%; margin: 2px 0; padding: 5px;">Manual Load</button>
        <button onclick="this.parentElement.style.display='none'" style="display: block; width: 100%; margin: 5px 0 0 0; padding: 5px; background: #666;">Hide Panel</button>
    `;
    
    document.body.appendChild(panel);
    
    console.log('🔧 Debug panel created in top-right corner');
}