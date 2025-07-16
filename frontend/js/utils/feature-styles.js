/**
 * Feature Styling Utilities
 * Backward compatibility wrapper for the new FeatureStyleManager
 */

class FeatureStyles {
    static _manager = null;

    /**
     * Get or create the style manager instance
     */
    static getManager() {
        if (!this._manager) {
            this._manager = new FeatureStyleManager();
        }
        return this._manager;
    }

    /**
     * Get configured styles from localStorage or defaults
     */
    static getConfiguredStyles() {
        return this.getManager().getConfiguredStyles();
    }

    /**
     * Get style for a feature based on its properties
     */
    static getFeatureStyle(feature) {
        return this.getManager().getFeatureStyle(feature);
    }

    /**
     * Get selected feature style (highlighted)
     */
    static getSelectedFeatureStyle(feature) {
        return this.getManager().getSelectedFeatureStyle(feature);
    }

    /**
     * Get style without icon (for turning_point features)
     */
    static getFeatureStyleWithoutIcon(feature) {
        const style = this.getFeatureStyle(feature);
        if (style && style.getText) {
            style.setText(null);
        }
        return style;
    }

    /**
     * Get modify style (hidden for clean appearance)
     */
    static getModifyStyle() {
        return null; // Hide modification handles
    }
    
    /**
     * Convert hex color to RGB values
     */
    static hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? 
            `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : 
            '255, 255, 255';
    }
}

// Export for use in modules
window.FeatureStyles = FeatureStyles;