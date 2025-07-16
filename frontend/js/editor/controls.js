/**
 * Controls Manager for Map Editor
 * Handles UI controls and event listeners
 */

class Controls {
    constructor(mapCore, drawingTools, featureManager) {
        this.mapCore = mapCore;
        this.drawingTools = drawingTools;
        this.featureManager = featureManager;
        this.editingEnabled = false;
        this.is3DEnabled = false;
        this.editor = null;
        
        this.initControls();
        this.disableEditing();
    }
    
    setEditor(editor) {
        this.editor = editor;
    }

    initControls() {
        // Drawing tool buttons
        document.getElementById('draw-point').addEventListener('click', () => {
            if (this.editingEnabled) this.drawingTools.enableDrawing('Point');
        });

        document.getElementById('draw-line').addEventListener('click', () => {
            if (this.editingEnabled) this.drawingTools.enableDrawing('LineString');
        });

        document.getElementById('draw-polygon').addEventListener('click', () => {
            if (this.editingEnabled) this.drawingTools.enableDrawing('Polygon');
        });

        document.getElementById('select').addEventListener('click', () => {
            this.drawingTools.disableDrawing();
        });


        // Feature management buttons
        document.getElementById('clear-all').addEventListener('click', () => {
            this.featureManager.clearAllFeatures();
        });

        document.getElementById('save-all').addEventListener('click', () => {
            this.featureManager.saveAllFeatures();
        });

        document.getElementById('load-features').addEventListener('click', () => {
            this.featureManager.loadFeatures();
        });

        document.getElementById('my-location').addEventListener('click', () => {
            this.mapCore.getUserLocation();
        });

        // Map data loading buttons
        document.getElementById('load-buildings').addEventListener('click', () => {
            this.featureManager.loadOSMData('buildings');
        });

        document.getElementById('load-roads').addEventListener('click', () => {
            this.featureManager.loadOSMData('roads');
        });

        document.getElementById('load-streetlights').addEventListener('click', () => {
            this.featureManager.loadOSMData('streetlights');
        });

        document.getElementById('load-traffic-lights').addEventListener('click', () => {
            this.featureManager.loadOSMData('traffic-lights');
        });

        // Toggle buttons
        document.getElementById('toggle-editing').addEventListener('click', () => {
            this.toggleEditing();
        });

        document.getElementById('toggle-3d').addEventListener('click', () => {
            this.toggle3D();
        });

        // Feature form buttons
        document.getElementById('save-feature').addEventListener('click', () => {
            this.featureManager.saveCurrentFeature();
        });

        document.getElementById('cancel-edit').addEventListener('click', () => {
            this.featureManager.clearSelection();
        });

        document.getElementById('delete-feature').addEventListener('click', () => {
            this.featureManager.deleteSelectedFeature();
        });
    }

    toggleEditing() {
        this.editingEnabled = !this.editingEnabled;
        const button = document.getElementById('toggle-editing');
        
        if (this.editingEnabled) {
            this.enableEditing();
            button.textContent = '🔓 Editing Enabled';
            button.classList.add('editing-enabled');
        } else {
            this.disableEditing();
            button.textContent = '🔒 Lock Editing';
            button.classList.remove('editing-enabled');
        }
    }

    enableEditing() {
        this.editingEnabled = true;
        if (this.editor) {
            this.editor.editingEnabled = true;
        }
        this.drawingTools.enableEditing();
    }

    disableEditing() {
        this.editingEnabled = false;
        if (this.editor) {
            this.editor.editingEnabled = false;
        }
        this.drawingTools.disableEditing();
    }

    toggle3D() {
        // 3D functionality would require additional libraries
        this.is3DEnabled = !this.is3DEnabled;
        const button = document.getElementById('toggle-3d');
        
        if (this.is3DEnabled) {
            button.textContent = '🗺️ Disable 3D';
            button.classList.add('editing-enabled');
            alert('3D mode requires additional setup. Feature coming soon!');
        } else {
            button.textContent = '🏢 Enable 3D';
            button.classList.remove('editing-enabled');
        }
    }
    
}

// Export for use in modules
window.Controls = Controls;