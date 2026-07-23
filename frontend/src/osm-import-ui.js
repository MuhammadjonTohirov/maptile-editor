import { featuresApi } from './api.js';
import { IMPORT_LAYERS, setLayerVisibility } from './layers.js';
import { t } from './strings.js';

// Catalog keys naming each OSM import kind, for localized import errors.
const IMPORT_KIND_KEYS = {
  buildings: 'kindBuildings',
  roads: 'kindRoads',
  streetlights: 'kindStreetlights',
  'traffic-lights': 'kindTrafficLights',
  businesses: 'kindBusinesses',
};

export class OsmImportUI {
  constructor({ map, elements, onImported, onStatus }) {
    this.map = map;
    this.elements = elements;
    this.onImported = onImported;
    this.onStatus = onStatus;
  }

  bind() {
    this.elements['toggle-imports'].addEventListener('change', (event) => {
      this.setLayerVisibility(event.target.checked);
    });
    this.elements['open-import'].addEventListener('click', () => this.togglePopup());
    this.elements['import-close'].addEventListener('click', () => {
      this.elements['import-popup'].hidden = true;
    });
    this.elements['import-list'].addEventListener('click', (event) => {
      const button = event.target.closest('button[data-kind]');
      if (button) this.importKind(button.dataset.kind, button);
    });
  }

  showImportedLayers() {
    this.elements['toggle-imports'].checked = true;
    this.setLayerVisibility(true);
  }

  setLayerVisibility(visible) {
    setLayerVisibility(this.map, IMPORT_LAYERS, visible);
  }

  togglePopup() {
    const popup = this.elements['import-popup'];
    if (popup.hidden) {
      const centre = this.map.getCenter();
      this.elements['import-area'].textContent = t('importAreaHint', {
        lat: centre.lat.toFixed(4),
        lon: centre.lng.toFixed(4),
      });
    }
    popup.hidden = !popup.hidden;
  }

  async importKind(kind, button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = t('importing');
    const bounds = this.map.getBounds();
    try {
      const result = await featuresApi.importOsm(kind, {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      });
      this.showImportedLayers();
      await this.onImported(kind, result);
      this.onStatus(result.message);
    } catch (error) {
      console.error(`Unable to import ${kind}`, error);
      this.onStatus(t('importFailed', {
        kind: t(IMPORT_KIND_KEYS[kind] ?? kind),
        message: error.message,
      }), true);
    } finally {
      button.textContent = original;
      button.disabled = false;
    }
  }
}
