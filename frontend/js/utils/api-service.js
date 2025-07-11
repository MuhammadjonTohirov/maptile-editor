/**
 * API Service for Map Features
 * Handles all backend communication
 */

class ApiService {
    constructor() {
        this.baseUrl = '/api';
    }

    /**
     * Get all features from backend
     */
    async getFeatures() {
        const response = await fetch(`${this.baseUrl}/features`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        return await response.json();
    }

    /**
     * Get specific feature by ID
     */
    async getFeature(id) {
        const response = await fetch(`${this.baseUrl}/features/${id}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        return await response.json();
    }

    /**
     * Create new feature
     */
    async createFeature(featureData) {
        const response = await fetch(`${this.baseUrl}/features`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(featureData)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        return await response.json();
    }

    /**
     * Update existing feature
     */
    async updateFeature(id, featureData) {
        const response = await fetch(`${this.baseUrl}/features/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(featureData)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        return await response.json();
    }

    /**
     * Delete feature by ID
     */
    async deleteFeature(id) {
        const response = await fetch(`${this.baseUrl}/features/${id}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        return await response.json();
    }

    /**
     * Clear all features
     */
    async clearAllFeatures() {
        const response = await fetch(`${this.baseUrl}/features/clear-all`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        return await response.json();
    }

    /**
     * Load OSM data for specific type and bounds
     */
    async loadOSMData(type, bounds) {
        const endpoints = {
            'buildings': `${this.baseUrl}/load-osm-buildings`,
            'roads': `${this.baseUrl}/load-osm-roads`,
            'streetlights': `${this.baseUrl}/load-osm-streetlights`,
            'traffic-lights': `${this.baseUrl}/load-osm-traffic-lights`
        };

        const response = await fetch(endpoints[type], {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bounds)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        return await response.json();
    }
}

// Export for use in modules
window.ApiService = ApiService;