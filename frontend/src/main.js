import { featuresApi } from './api.js';
import { AuthController } from './auth-ui.js';
import { captureBaseFilters } from './base-masks.js';
import {
  addTileSymbolLayers,
  paintEditorAsBasemap,
  TILE_SYMBOL_LAYERS,
} from './basemap-render.js';
import { BulkLoadUI } from './bulk-load-ui.js';
import { EditorData } from './editor-data.js';
import { EditorInteractions } from './editor-interactions.js';
import { enableEmojiIcons } from './emoji-icons.js';
import { FeatureActions } from './feature-actions.js';
import { FeatureEditor } from './feature-editor.js';
import { FeatureForm } from './feature-form.js';
import { FeatureMenuUI } from './feature-menu.js';
import { FeatureSearchUI } from './feature-search.js';
import {
  EDITOR_LAYERS,
} from './layers.js';
import { createMap, addBaseControls } from './map-setup.js';
import { OsmImportUI } from './osm-import-ui.js';
import { RoadConnectivityUI } from './road-connectivity-ui.js';
import { RoadGuidanceUI } from './road-guidance.js';
import { RoadNetworkUI } from './road-network-ui.js';
import { RouteUI } from './route-ui.js';
import { SnappingUI } from './snapping-ui.js';
import {
  currentLocale,
  localizeDocument,
  setLocale,
  t,
} from './strings.js';
import './app.css';

const ELEMENT_IDS = [
  'status',
  'edit-state',
  'zoom-level',
  'feature-count',
  'toggle-editing',
  'draw-point',
  'draw-line',
  'draw-polygon',
  'draw-rect',
  'draw-circle',
  'select',
  'undo-edit',
  'duplicate-feature',
  'delete-feature',
  'toggle-imports',
  'toggle-3d',
  'feature-panel',
  'feature-name',
  'feature-description',
  'feature-icon',
  'feature-geometry',
  'feature-audit',
  'feature-type',
  'building-fields',
  'building-type',
  'building-number',
  'building-height',
  'road-fields',
  'road-type',
  'new-road-type',
  'road-access',
  'road-direction',
  'lane-count',
  'max-speed',
  'max-speed-field',
  'road-surface',
  'road-connectivity-hint',
  'business-fields',
  'business-type',
  'business-floor',
  'business-phone',
  'business-hours',
  'building-businesses',
  'add-business',
  'feature-search',
  'feature-search-options',
  'hidden-objects',
  'save-feature',
  'cancel-feature',
  'close-feature',
  'clear-all',
  'my-location',
  'open-import',
  'import-popup',
  'import-close',
  'import-area',
  'import-list',
  'find-route',
  'clear-route',
  'route-details',
  'route-status',
  'route-details-modal',
  'route-details-close',
  'route-details-summary',
  'route-details-json',
  'route-details-list',
  'road-network-state',
  'rebuild-road-network',
  'route-profile-foot',
  'route-profile-bicycle',
  'route-profile-car',
];

class MapEditor {
  constructor() {
    this.map = null;
    this.draw = null;
    this.editingEnabled = false;
    this.fullBase = false;
    this.totalFeatureCount = null;
    this.interactiveLayers = EDITOR_LAYERS;
    this.selected = null;
    this.editorRevision = 0;
    this.snapVertices = [];
    this.visibleFeatures = [];
    this.currentUser = null;
    this.elements = Object.fromEntries(
      ELEMENT_IDS.map((id) => [id, document.getElementById(id)]),
    );

    this.auth = new AuthController({
      onAuthenticated: (user) => this.onAuthenticated(user),
      onLoggedOut: () => this.onLoggedOut(),
    });
    this.bulkLoad = new BulkLoadUI({
      onComplete: () => {
        this.refreshEditorTiles();
        this.refreshEditorData();
        this.markRoadNetworkStale();
      },
    });
    this.featureMenu = new FeatureMenuUI({
      onOperation: (operation) => this.actions.handleMenuOperation(operation),
    });
    this.featureForm = new FeatureForm(this.elements, t, {
      onRoadDirectionChange: () => this.updateRoadGuidance(),
    });
    this.featureForm.bind();

    this.createMap();
    this.createControllers();
    this.interactions.bindControls();
    this.auth.init();
  }

  createControllers() {
    this.editorData = new EditorData({
      map: this.map,
      featureCount: this.elements['feature-count'],
    });
    this.roadConnectivity = new RoadConnectivityUI(this.map);
    this.roadSegmentIndex = this.roadConnectivity.segmentIndex;
    this.snapping = new SnappingUI({
      map: this.map,
      getDrawMode: () => this.draw?.getMode(),
      getSelected: () => this.selected,
      getRoadSegmentIndex: () => this.roadSegmentIndex,
      getVertices: () => this.snapVertices,
    });
    this.roadGuidance = new RoadGuidanceUI(this.map);
    this.route = new RouteUI({
      map: this.map,
      elements: this.elements,
      onStatus: (message, isError) => this.setStatus(message, isError),
      onArm: () => {
        if (!this.editingEnabled) return;
        this.draw.setMode('select');
        this.snapping.updateIndicator(undefined);
      },
    });
    this.roadNetwork = new RoadNetworkUI({
      button: this.elements['rebuild-road-network'],
      stateElement: this.elements['road-network-state'],
      onStatus: (message, isError) => this.setStatus(message, isError),
      onRebuilt: async () => {
        await this.refreshEditorData();
        await this.route.refreshAfterRebuild();
      },
    });
    this.featureSearch = new FeatureSearchUI({
      map: this.map,
      input: this.elements['feature-search'],
      options: this.elements['feature-search-options'],
      onStatus: (message, isError) => this.setStatus(message, isError),
    });
    this.featureSearch.bind();
    this.osmImport = new OsmImportUI({
      map: this.map,
      elements: this.elements,
      onImported: async (kind, result) => {
        this.refreshEditorTiles();
        await this.refreshEditorData();
        if (kind === 'roads' && result.roads_loaded > 0) {
          this.markRoadNetworkStale();
        }
      },
      onStatus: (message, isError) => this.setStatus(message, isError),
    });
    this.osmImport.bind();
    this.featureEditor = new FeatureEditor(this);
    this.actions = new FeatureActions(this);
    this.interactions = new EditorInteractions(this);
  }

  createMap() {
    this.map = createMap();
    enableEmojiIcons(this.map);
    addBaseControls(this.map);
    this.map.on('load', async () => {
      this.baseFilters = captureBaseFilters(this.map);
      try {
        const meta = await featuresApi.meta();
        this.fullBase = meta.full_base;
        this.totalFeatureCount = meta.feature_count;
      } catch (error) {
        console.error('Unable to read map metadata', error);
      }
      if (this.fullBase) {
        paintEditorAsBasemap(this.map);
        addTileSymbolLayers(this.map);
        this.interactiveLayers = [...EDITOR_LAYERS, ...TILE_SYMBOL_LAYERS];
        this.elements['toggle-imports'].checked = true;
      }
      this.interactions.createDrawing();
      this.interactions.bindMap();
      this.updateZoom();
      await this.refreshEditorData();
      this.setStatus(t('basemapReady'));
    });
    this.map.on('zoom', () => this.updateZoom());
    this.map.on('error', (event) => {
      console.error('MapLibre error', event.error);
      this.setStatus(t('mapError', { message: event.error.message }), true);
    });
  }

  onAuthenticated(user) {
    this.currentUser = user;
    this.elements['clear-all'].hidden = !user.is_admin;
    this.bulkLoad.setAdmin(user.is_admin);
    this.roadNetwork.setUser(user);
    if (this.selected) this.featureEditor.showFeaturePanel();
  }

  onLoggedOut() {
    this.currentUser = null;
    this.route.clear();
    this.roadNetwork.setUser(null);
    if (this.editingEnabled) this.interactions.toggleEditing();
  }

  refreshEditorTiles() {
    this.editorRevision += 1;
    this.map.getSource('editor')?.setTiles([
      `/tiles/editor/{z}/{x}/{y}?revision=${this.editorRevision}`,
    ]);
  }

  markRoadNetworkStale() {
    this.roadNetwork.markStale();
    this.route.invalidateNetwork();
  }

  async refreshEditorData() {
    const data = await this.editorData.refresh({
      fullBase: this.fullBase,
      totalFeatureCount: this.totalFeatureCount,
      baseFilters: this.baseFilters,
    });
    if (!data) return;
    this.visibleFeatures = data.visible;
    this.snapVertices = data.snapVertices;
    this.updateRoadConnectivity(data.visible);
    if (data.tombstones) this.actions.renderHiddenObjects(data.tombstones);
  }

  updateRoadConnectivity(features) {
    const state = this.roadConnectivity.update(
      features,
      this.selected,
      this.selected?.properties?.feature_type === 'road'
        ? this.featureEditor.currentSelectedGeometry()
        : null,
    );
    this.roadSegmentIndex = state.segmentIndex;
    this.updateSelectedRoadConnectivityHint();
    this.updateRoadGuidance();
  }

  updateRoadGuidance() {
    if (!this.editingEnabled || this.selected?.properties?.feature_type !== 'road') {
      this.roadGuidance?.clear();
      return;
    }
    this.roadGuidance.update({
      id: this.selected.serverId,
      geometry: this.featureEditor.currentSelectedGeometry(),
      properties: {
        ...this.selected.properties,
        direction: this.elements['road-direction'].value
          || this.selected.properties.direction
          || 'bidirectional',
      },
    }, this.roadSegmentIndex, this.selected.roadSpan
      ? null
      : this.selected.roadSelectionCoordinate);
  }

  selectedRoadConnectedEnds() {
    if (!this.selected || this.selected.properties?.feature_type !== 'road') {
      return 0;
    }
    return this.roadConnectivity.connectedEnds(this.selected.serverId);
  }

  updateSelectedRoadConnectivityHint() {
    const hint = this.elements['road-connectivity-hint'];
    if (!hint || !this.selected || this.selected.properties?.feature_type !== 'road') {
      if (hint) hint.textContent = '';
      return;
    }
    const connected = this.selectedRoadConnectedEnds();
    hint.textContent = connected === 2
      ? t('roadConnectivityReady')
      : t('roadConnectivityCount', { connected, total: 2 });
  }

  goToUserLocation() {
    if (!navigator.geolocation) {
      this.setStatus(t('geolocationUnsupported'), true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => this.map.flyTo({
        center: [position.coords.longitude, position.coords.latitude],
        zoom: 15,
        essential: true,
      }),
      () => this.setStatus(t('geolocationFailed'), true),
      {
        enableHighAccuracy: true,
        timeout: 12_000,
        maximumAge: 60_000,
      },
    );
  }

  updateZoom() {
    this.elements['zoom-level'].textContent = Math.round(this.map.getZoom());
  }

  setStatus(message, isError = false) {
    this.elements.status.textContent = message;
    this.elements.status.style.color = isError ? '#b42318' : '';
  }
}

localizeDocument();
for (const button of document.querySelectorAll('.lang-switch [data-locale]')) {
  button.classList.toggle('active', button.dataset.locale === currentLocale());
  button.addEventListener('click', () => setLocale(button.dataset.locale));
}
window.mapEditor = new MapEditor();
