import {
  TerraDraw,
  TerraDrawCircleMode,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { ApiError, featuresApi, isMissing } from './api.js';
import { AuthController } from './auth-ui.js';
import { BulkLoadUI } from './bulk-load-ui.js';
import { FeatureMenuUI } from './feature-menu.js';
import { RoadNetworkUI } from './road-network-ui.js';
import { RouteUI } from './route-ui.js';
import { captureBaseFilters, applyBaseFeatureMasks } from './base-masks.js';
import {
  addTileSymbolLayers,
  paintEditorAsBasemap,
  EDITOR_3D_LAYER,
  TILE_SYMBOL_LAYERS,
} from './basemap-render.js';
import { enableEmojiIcons, featureAnchors } from './emoji-icons.js';
import {
  circularise,
  collectVertices,
  drawingModeForGeometry,
  flipLong,
  flipShort,
  geometryBounds,
  normalizeGeometry,
  offsetGeometry,
  orthogonalize,
  roadConnectivity,
  RoadSegmentIndex,
} from './geometry.js';
import {
  canSnapRoadCoordinate,
  RoadEditSession,
  ROAD_SNAP_DEGREES,
  snapRoadEndpoints,
  validateRoadLineString,
} from './road-editing.js';
import {
  isVehicleRoadType,
  populateRoadControls,
  setControlledSelectValue,
  updateRoadSpeedControl,
} from './road-options.js';
import {
  BASE_EDITABLE_LAYERS,
  EDITOR_LAYERS,
  IMPORT_LAYERS,
  setLayerVisibility,
} from './layers.js';
import { createMap, addBaseControls } from './map-setup.js';
import { currentLocale, localizeDocument, setLocale, t } from './strings.js';

// Catalog keys naming each OSM import kind, for localized import errors.
const IMPORT_KIND_KEYS = {
  buildings: 'kindBuildings',
  roads: 'kindRoads',
  streetlights: 'kindStreetlights',
  'traffic-lights': 'kindTrafficLights',
  businesses: 'kindBusinesses',
};
import './app.css';

// Feature columns are canonical on the server; the JSONB properties blob only
// stores extras (osm_tags, base_* linkage), so payloads strip these keys from
// stored properties before sending them back.
const COLUMN_KEYS = [
  'name', 'description', 'icon', 'building_type', 'building_number',
  'road_type', 'direction', 'lane_count', 'max_speed', 'surface',
  'source_kind', 'feature_type', 'osm_id', 'osm_type', 'height_m',
  'business_type', 'building_id', 'created_by', 'updated_by',
];

// Category → suggested emoji; only fills an empty icon field, never overwrites.
const BUSINESS_ICONS = {
  shop: '🏪', restaurant: '🍽️', cafe: '☕', pharmacy: '💊',
  bank: '🏦', office: '🏢', other: '🏷️',
};

// Viewport reads for snapping stay well under the backend's cap so a query at
// country scale can never return an unbounded set.
const VIEWPORT_FEATURE_LIMIT = 2000;
// Below this zoom individual features are neither editable nor worth fetching
// for snapping; rendering is entirely from tiles.
const EDIT_ZOOM = 15;

const DRAW_MODE_BUTTONS = {
  point: 'draw-point',
  linestring: 'draw-line',
  polygon: 'draw-polygon',
  rectangle: 'draw-rect',
  circle: 'draw-circle',
  select: 'select',
};

const FORM_FIELDS = [
  'feature-name', 'feature-description', 'feature-icon', 'building-type',
  'building-number', 'building-height', 'road-type', 'road-access', 'road-direction',
  'lane-count', 'max-speed', 'road-surface', 'business-type',
  'business-floor', 'business-phone', 'business-hours',
];

function extraProperties(properties) {
  return Object.fromEntries(
    Object.entries(properties || {}).filter(([key]) => !COLUMN_KEYS.includes(key)),
  );
}

class MapEditor {
  constructor() {
    this.map = null;
    this.draw = null;
    this.editingEnabled = false;
    // Full base: the whole country is loaded as editor data, rendered from
    // tiles with the basemap palette; there is no per-area import or base copy.
    this.fullBase = false;
    this.totalFeatureCount = null;
    this.interactiveLayers = EDITOR_LAYERS;
    this.selected = null;
    this.editorRevision = 0;
    this.pendingBaseCopies = new Set();
    this.undoStack = [];
    this.snapVertices = [];
    this.roadSegmentIndex = new RoadSegmentIndex();
    this.roadConnectivityMarkers = [];
    this.snapIndicatorKey = null;
    this.pendingDrawFeatureType = null;
    this.pendingRoadType = null;
    this.roadEditSession = new RoadEditSession();
    this.visibleFeatures = [];
    this.preparedRoadAreas = [];
    this.preparingRoads = false;
    this.roadPrepareCooldown = 0;
    this.roadPrepareTimer = null;
    this.elements = Object.fromEntries(
      [
        'status', 'edit-state', 'zoom-level', 'feature-count', 'toggle-editing', 'draw-point',
        'draw-line', 'draw-polygon', 'draw-rect', 'draw-circle', 'select',
        'undo-edit', 'duplicate-feature', 'delete-feature', 'toggle-imports',
        'toggle-3d', 'feature-panel', 'feature-name', 'feature-description',
        'feature-icon', 'feature-geometry', 'feature-audit', 'feature-type', 'building-fields',
        'building-type', 'building-number', 'building-height', 'road-fields', 'road-type',
        'new-road-type', 'road-access', 'road-direction', 'lane-count', 'max-speed', 'max-speed-field', 'road-surface',
        'road-connectivity-hint',
        'business-fields', 'business-type', 'business-floor', 'business-phone',
        'business-hours', 'building-businesses', 'add-business',
        'feature-search', 'feature-search-options', 'hidden-objects',
        'save-feature', 'cancel-feature', 'close-feature', 'clear-all', 'my-location',
        'open-import', 'import-popup', 'import-close', 'import-area', 'import-list',
        'find-route', 'clear-route', 'route-status', 'road-network-state', 'rebuild-road-network',
        'route-profile-foot', 'route-profile-bicycle', 'route-profile-car',
      ].map((id) => [id, document.getElementById(id)]),
    );

    this.currentUser = null;
    // The editor page is unusable until a user signs in; reads stay public on
    // the separate client viewer. Auth wiring lives in auth-ui.js.
    this.auth = new AuthController({
      onAuthenticated: (user) => this.onAuthenticated(user),
      onLoggedOut: () => this.onLoggedOut(),
    });
    // Admin-only bulk load; refreshes the map when a load finishes.
    this.bulkLoad = new BulkLoadUI({
      onComplete: () => {
        this.refreshEditorTiles();
        this.refreshEditorData();
        this.markRoadNetworkStale();
      },
    });
    // Right-click operations menu for the selected feature (Circularise,
    // Square, Flip, Copy, Delete).
    this.featureMenu = new FeatureMenuUI({
      onOperation: (op) => this.handleFeatureMenuOperation(op),
    });

    populateRoadControls(this.elements, t);

    this.createMap();
    this.route = new RouteUI({
      map: this.map,
      elements: this.elements,
      onStatus: (message, isError) => this.setStatus(message, isError),
      onArm: () => {
        if (!this.editingEnabled) return;
        this.draw.setMode('select');
        this.updateSnapIndicator(undefined);
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
    this.bindControls();
    this.auth.init();
  }

  onAuthenticated(user) {
    this.currentUser = user;
    // Clearing all data, bulk loading, and rebuilding the road network are
    // admin-only on the server; hide their buttons for non-admins.
    this.elements['clear-all'].hidden = !user.is_admin;
    this.bulkLoad.setAdmin(user.is_admin);
    this.roadNetwork.setUser(user);
    // A feature may already be open (session refreshed) — repaint its audit line.
    if (this.selected) this.showFeaturePanel();
  }

  onLoggedOut() {
    this.currentUser = null;
    this.route.clear();
    this.roadNetwork.setUser(null);
    // Drop out of editing so no tools linger once the session ends.
    if (this.editingEnabled) this.toggleEditing();
  }

  setSelectValue(elementId, value) {
    setControlledSelectValue(this.elements[elementId], value, t);
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
        // Cached so panning does not re-run a count over millions of rows;
        // it is a total-features readout, not a live figure.
        this.totalFeatureCount = meta.feature_count;
      } catch (error) {
        console.error('Unable to read map metadata', error);
      }
      if (this.fullBase) {
        // Render the country from editor tiles and hide the base OSM detail,
        // so every feature is directly editable with no import or copy step.
        paintEditorAsBasemap(this.map);
        addTileSymbolLayers(this.map);
        this.interactiveLayers = [...EDITOR_LAYERS, ...TILE_SYMBOL_LAYERS];
        this.elements['toggle-imports'].checked = true;
      }
      this.createDrawing();
      this.bindMapInteractions();
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

  createDrawing() {
    const adapter = new TerraDrawMapLibreGLAdapter({
      map: this.map,
      prefixId: 'editor-draw',
    });
    // Terra Draw's own store only holds the feature being edited, so snapping
    // targets the saved editor features instead.
    const snapping = { toCustom: (event, context) => this.snapToEditorTarget(event, context) };
    const editableCoordinates = { draggable: true, midpoints: true, deletable: true, snappable: snapping };
    this.draw = new TerraDraw({
      adapter,
      modes: [
        new TerraDrawPointMode(),
        new TerraDrawLineStringMode({ snapping }),
        new TerraDrawPolygonMode({ snapping }),
        new TerraDrawRectangleMode(),
        new TerraDrawCircleMode(),
        new TerraDrawSelectMode({
          flags: {
            point: { feature: { draggable: true } },
            linestring: { feature: { draggable: true, rotateable: true, scaleable: true, coordinates: editableCoordinates } },
            polygon: { feature: { draggable: true, rotateable: true, scaleable: true, coordinates: editableCoordinates } },
          },
        }),
      ],
    });
    this.draw.on('finish', (id, context) => this.persistFinishedDraw(id, context));
    this.draw.start();
    this.draw.setMode('select');
  }

  bindMapInteractions() {
    this.map.on('click', async (event) => {
      // The route tool owns clicks while armed, regardless of what Terra
      // Draw is doing — arming already force-cancelled any active draw.
      if (this.route.handleMapClick(event)) return;

      // While actively placing a new point/line/polygon, clicks belong to
      // Terra Draw alone (vertex placement, snapping to existing roads via
      // snapToEditorTarget). Hit-testing for selection here would call
      // draw.clear() through selectRenderedFeature/beginGeometryEditing and
      // cancel the in-progress drawing instead of letting it snap.
      if (this.draw.getMode() !== 'select') return;

      // Thin lines are hard to hit exactly, so selection uses a small box
      // around the pointer instead of the single pixel.
      const reach = 6;
      const clickBox = [
        [event.point.x - reach, event.point.y - reach],
        [event.point.x + reach, event.point.y + reach],
      ];
      const rendered = this.map.queryRenderedFeatures(clickBox, { layers: this.interactiveLayers });
      if (rendered.length) {
        const featureId = rendered[0].id ?? rendered[0].properties?.id;
        // Clicks on a feature already under edit belong to Terra Draw's select
        // mode (vertex drags, midpoint inserts); re-selecting would reset them.
        if (this.isEditingFeature(featureId)) return;
        await this.selectRenderedFeature(rendered[0]);
        return;
      }

      if (this.editingEnabled) {
        const baseFeature = this.map
          .queryRenderedFeatures(clickBox, { layers: BASE_EDITABLE_LAYERS })
          .find((feature) => normalizeGeometry(feature.geometry));
        if (baseFeature) {
          await this.copyBaseFeatureToEditor(baseFeature);
          return;
        }
      }

      if (this.selected) this.cancelSelectedEditing({ announce: false });
      else this.clearSelection();
    });
    this.map.on('mousemove', (event) => this.previewSnapWhileDrawing(event));
    // Only opens the ops menu when the right-click lands on the already-
    // selected feature; a right-click elsewhere (including on a Terra Draw
    // vertex handle, whose layers aren't in interactiveLayers, so its own
    // right-click-to-delete-vertex behavior is untouched) is a no-op here.
    this.map.on('contextmenu', (event) => this.handleContextMenu(event));
    this.map.on('moveend', () => {
      if (this.fullBase) {
        // The whole country is already loaded; only the viewport's snapping
        // targets need refreshing — no per-area import runs.
        clearTimeout(this.viewportTimer);
        this.viewportTimer = setTimeout(() => this.refreshEditorData(), 400);
        return;
      }
      if (!this.editingEnabled) return;
      clearTimeout(this.roadPrepareTimer);
      this.roadPrepareTimer = setTimeout(() => this.prepareViewportRoads(), 1500);
    });
    this.interactiveLayers.forEach((layerId) => {
      this.map.on('mouseenter', layerId, () => { this.map.getCanvas().style.cursor = 'pointer'; });
      this.map.on('mouseleave', layerId, () => { this.map.getCanvas().style.cursor = ''; });
    });
    // Edits made in another tab never bump this tab's overlay revision, so
    // returning to the tab is the moment to drop ghost features from memory.
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) return;
      this.refreshEditorTiles();
      await this.refreshEditorData();
    });
  }

  bindControls() {
    this.elements['toggle-editing'].addEventListener('click', () => this.toggleEditing());
    this.elements['draw-point'].addEventListener('click', () => this.setDrawMode('point'));
    this.elements['draw-line'].addEventListener('click', () => this.setDrawMode('linestring'));
    this.elements['draw-polygon'].addEventListener('click', () => this.setDrawMode('polygon'));
    this.elements['draw-rect'].addEventListener('click', () => this.setDrawMode('rectangle'));
    this.elements['draw-circle'].addEventListener('click', () => this.setDrawMode('circle'));
    this.elements['select'].addEventListener('click', () => this.setDrawMode('select'));
    this.elements['undo-edit'].addEventListener('click', () => this.undoLast());
    this.elements['duplicate-feature'].addEventListener('click', () => this.duplicateSelected());
    this.elements['delete-feature'].addEventListener('click', () => this.deleteSelected());
    this.elements['feature-search'].addEventListener('change', (event) => this.jumpToFeature(event.target.value));
    this.elements['feature-search'].addEventListener('input', (event) => {
      clearTimeout(this.searchTimer);
      const query = event.target.value.trim();
      if (query.length < 2) return;
      this.searchTimer = setTimeout(() => this.populateSearchOptions(query), 250);
    });
    document.addEventListener('keydown', (event) => this.handleEditorKeydown(event), true);
    this.elements['save-feature'].addEventListener('click', () => this.saveProperties());
    this.elements['cancel-feature'].addEventListener('click', () => this.cancelSelectedEditing());
    this.elements['close-feature'].addEventListener('click', () => this.cancelSelectedEditing());
    this.elements['feature-type'].addEventListener('change', () => this.updatePropertyFieldVisibility());
    this.elements['new-road-type'].addEventListener('change', () => this.updateRoadDrawAvailability());
    this.elements['road-type'].addEventListener('change', (event) => {
      updateRoadSpeedControl(this.elements, event.target.value, { applyDefault: true });
    });
    this.elements['add-business'].addEventListener('click', () => this.addBusinessToBuilding());
    this.elements['business-type'].addEventListener('change', () => {
      const icon = BUSINESS_ICONS[this.elements['business-type'].value];
      if (icon && !this.elements['feature-icon'].value.trim()) this.elements['feature-icon'].value = icon;
    });
    this.elements['toggle-imports'].addEventListener('change', (event) => this.setImportedLayerVisibility(event.target.checked));
    this.elements['toggle-3d'].addEventListener('change', (event) => {
      // Full base extrudes editor buildings; overlay extrudes the base tiles.
      const layer = this.fullBase ? EDITOR_3D_LAYER : 'base-buildings-3d';
      setLayerVisibility(this.map, [layer], event.target.checked);
    });
    this.elements['clear-all'].addEventListener('click', () => this.clearAll());
    this.elements['my-location'].addEventListener('click', () => this.goToUserLocation());
    this.elements['open-import'].addEventListener('click', () => this.toggleImportPopup());
    this.elements['import-close'].addEventListener('click', () => { this.elements['import-popup'].hidden = true; });
    this.elements['import-list'].addEventListener('click', (event) => {
      const button = event.target.closest('button[data-kind]');
      if (button) this.importOSM(button.dataset.kind, button);
    });
    document.querySelectorAll('#icon-presets button').forEach((button) => {
      button.addEventListener('click', () => {
        this.elements['feature-icon'].value = 'clear' in button.dataset ? '' : button.textContent;
      });
    });
  }

  handleEditorKeydown(event) {
    if (this.route.handleKeydown(event)) return;
    if (event.key === 'Escape') {
      if (this.draw.getMode() !== 'select') {
        event.preventDefault();
        event.stopPropagation();
        this.cancelActiveDrawing();
        return;
      }
      if (this.selected) {
        event.preventDefault();
        event.stopPropagation();
        this.cancelSelectedEditing();
      }
      return;
    }
    if (!(event.key === 'z' && (event.ctrlKey || event.metaKey))) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    event.preventDefault();
    this.undoLast();
  }

  toggleEditing() {
    this.editingEnabled = !this.editingEnabled;
    const toggleEditing = this.elements['toggle-editing'];
    toggleEditing.textContent = this.editingEnabled ? t('disableEditing') : t('enableEditing');
    toggleEditing.classList.toggle('primary', !this.editingEnabled);
    ['draw-point', 'draw-line', 'draw-polygon', 'draw-rect', 'draw-circle', 'select', 'undo-edit'].forEach((id) => {
      this.elements[id].disabled = !this.editingEnabled;
    });
    this.elements['new-road-type'].disabled = !this.editingEnabled;
    this.updateRoadDrawAvailability();
    if (!this.editingEnabled) {
      this.draw.clear();
      this.draw.setMode('select');
      this.clearSelection();
      this.updateSnapIndicator(undefined);
    }
    this.setStatus(this.editingEnabled ? t('editingEnabled') : t('editingDisabled'));
    if (this.editingEnabled) this.prepareViewportRoads(true);
  }

  updateRoadDrawAvailability() {
    this.elements['draw-line'].disabled = !this.editingEnabled || !this.elements['new-road-type'].value;
  }

  setInteractionState(state) {
    document.body.classList.toggle('road-drawing', state === 'drawing');
    document.body.classList.toggle('road-editing', state === 'editing');
    const indicator = this.elements['edit-state'];
    indicator.hidden = !state;
    indicator.textContent = state ? t(state === 'drawing' ? 'roadDrawingState' : 'roadEditingState') : '';
  }

  cancelActiveDrawing() {
    this.draw.clear();
    this.draw.setMode('select');
    this.pendingDrawFeatureType = null;
    this.pendingRoadType = null;
    this.updateSnapIndicator(undefined);
    this.setInteractionState(null);
    Object.values(DRAW_MODE_BUTTONS).forEach((id) => this.elements[id].classList.remove('active'));
    this.elements.select.classList.add('active');
    this.setStatus(t('drawingCancelled'));
  }

  cancelSelectedEditing({ announce = true } = {}) {
    if (!this.selected) return;
    const wasRoad = this.selected.properties?.feature_type === 'road';
    const changed = wasRoad && this.roadEditSession.isDirty(this.selected.serverId);
    this.draw.clear();
    this.roadEditSession.cancel();
    this.clearSelection();
    if (announce) this.setStatus(t(changed ? 'roadEditCancelled' : 'editingCancelled'));
  }

  // Base roads are thin and their tile geometry is fragmented, so editing mode
  // imports the viewport's roads from OSM: full geometries, upserted by OSM id,
  // rendered as easily tappable editor features.
  async prepareViewportRoads(announce = false) {
    if (!this.editingEnabled || this.preparingRoads) return;
    // Full-base installations already have authoritative full geometries in
    // PostGIS. Re-fetching the viewport from Overpass is redundant and used to
    // overwrite locally edited OSM attributes when edit mode was enabled.
    if (this.fullBase) return;
    if (this.map.getZoom() < 15) {
      if (announce) this.setStatus(t('editingZoomHint'));
      return;
    }
    if (Date.now() < this.roadPrepareCooldown) return;
    const bounds = this.map.getBounds();
    const box = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
    const covered = this.preparedRoadAreas.some((area) =>
      box[0] >= area[0] && box[1] >= area[1] && box[2] <= area[2] && box[3] <= area[3]);
    if (covered) return;
    this.preparingRoads = true;
    try {
      const result = await featuresApi.importOsm('roads', {
        west: box[0], south: box[1], east: box[2], north: box[3],
      });
      this.preparedRoadAreas.push(box);
      if (this.preparedRoadAreas.length > 20) this.preparedRoadAreas.shift();
      this.elements['toggle-imports'].checked = true;
      this.setImportedLayerVisibility(true);
      this.refreshEditorTiles();
      await this.refreshEditorData();
      if (result.roads_loaded > 0) this.markRoadNetworkStale();
      this.setStatus(t('roadsPrepared', { count: result.roads_loaded }));
    } catch (error) {
      console.error('Unable to prepare viewport roads', error);
      this.roadPrepareCooldown = Date.now() + 30_000;
      this.setStatus(t('roadsPrepareFailed'), true);
    } finally {
      this.preparingRoads = false;
    }
  }

  setDrawMode(mode) {
    if (!this.editingEnabled) return;
    if (mode !== 'select') {
      // Starting a fresh shape must not inherit the selected feature's form
      // values. Road class is the one intentional value carried in from the
      // dedicated new-road selector.
      this.draw.clear();
      this.clearSelection();
    }
    if (mode === 'linestring') {
      const roadType = this.elements['new-road-type'].value;
      if (!roadType) {
        this.setStatus(t('selectRoadClassFirst'), true);
        this.elements['new-road-type'].focus();
        return;
      }
      this.pendingDrawFeatureType = 'road';
      this.pendingRoadType = roadType;
      this.setSelectValue('road-type', roadType);
      updateRoadSpeedControl(this.elements, roadType, { applyDefault: true });
      this.setStatus(t('roadDrawingActive'));
      this.setInteractionState('drawing');
    } else if (mode !== 'select') {
      this.pendingDrawFeatureType = null;
      this.pendingRoadType = null;
      this.setInteractionState(null);
    } else {
      this.setInteractionState(this.selected?.properties?.feature_type === 'road' ? 'editing' : null);
    }
    this.draw.setMode(mode);
    this.updateSnapIndicator(undefined);
    Object.values(DRAW_MODE_BUTTONS).forEach((id) => this.elements[id].classList.remove('active'));
    this.elements[DRAW_MODE_BUTTONS[mode]].classList.add('active');
  }

  // Normalizes the id type once so identity checks never compare a number to
  // a string (rule F3).
  adoptSavedFeature(saved) {
    this.selected = {
      serverId: String(saved.id),
      geometry: saved.geometry,
      properties: this.mergeFeatureProperties(saved),
    };
  }

  async persistFinishedDraw(drawId) {
    const feature = this.draw.getSnapshotFeature(drawId);
    if (!feature || !this.editingEnabled || !feature.geometry) return;
    const serverId = feature.properties?.serverId;
    const editingSelected = serverId && this.selected && this.selected.serverId === String(serverId);
    // Terra Draw only carries {serverId, mode}; a geometry edit must build its
    // payload from the authoritative stored properties, or saving would reset
    // source_kind, the OSM identity, and the base_* masking linkage.
    const storedProperties = editingSelected ? this.selected.properties : (feature.properties || {});
    const isRoad = (editingSelected && storedProperties.feature_type === 'road')
      || (!serverId && this.pendingDrawFeatureType === 'road');
    let geometry = feature.geometry;
    if (isRoad) {
      geometry = snapRoadEndpoints(
        geometry,
        this.roadSegmentIndex,
        editingSelected ? serverId : null,
      );
      const validation = validateRoadLineString(geometry);
      if (!validation.valid) {
        const fallback = editingSelected && this.roadEditSession.geometry(serverId);
        if (fallback) this.draw.updateFeatureGeometry(drawId, fallback);
        else if (this.draw.hasFeature(drawId)) this.draw.removeFeatures([drawId]);
        this.setStatus(t(validation.reason), true);
        return;
      }
      if (editingSelected) {
        if (JSON.stringify(geometry) !== JSON.stringify(feature.geometry)) {
          this.draw.updateFeatureGeometry(drawId, geometry);
        }
        this.roadEditSession.stage(geometry);
        this.updateRoadConnectivity(this.visibleFeatures);
        this.setInteractionState('editing');
        this.setStatus(t('roadGeometryDraft'));
        return;
      }
      // A browser double-click can deliver more than one completion callback;
      // one draw id is allowed to create exactly one server row.
      if (!this.roadEditSession.claimNewDraw(drawId)) return;
    }
    const payload = this.makeFeaturePayload(geometry, storedProperties);
    const previous = editingSelected
      ? { geometry: this.selected.geometry, properties: { ...this.selected.properties } }
      : null;
    try {
      const saved = serverId
        ? await featuresApi.update(serverId, payload)
        : await featuresApi.create(payload);
      if (!serverId) {
        this.pushUndo(
          () => featuresApi.remove(saved.id, { confirmPublished: true }),
          { roadMutation: saved.feature_type === 'road' },
        );
      } else if (previous) {
        this.pushUndo(
          () => featuresApi.update(serverId, this.rawFeaturePayload(previous.geometry, previous.properties)),
          { roadMutation: saved.feature_type === 'road' || previous.properties.feature_type === 'road' },
        );
      }
      this.draw.removeFeatures([drawId]);
      this.adoptSavedFeature(saved);
      this.refreshEditorTiles();
      await this.refreshEditorData();
      this.showFeaturePanel();
      this.beginGeometryEditing(String(saved.id), saved.geometry);
      const savedIsRoad = saved.feature_type === 'road';
      if (savedIsRoad) this.markRoadNetworkStale();
      this.setStatus(savedIsRoad
        ? t('roadCreated', { connected: this.selectedRoadConnectedEnds(), total: 2 })
        : t('featureCreated'));
      this.pendingDrawFeatureType = null;
      this.pendingRoadType = null;
    } catch (error) {
      if (isRoad && !serverId) this.roadEditSession.releaseNewDraw(drawId);
      if (serverId && isMissing(error)) {
        await this.handleMissingFeature(t('featureMissingSave'));
        return;
      }
      console.error('Unable to save drawing', error);
      this.setStatus(t('featureSaveFailed'), true);
    }
  }

  async selectRenderedFeature(feature) {
    const featureId = feature.id ?? feature.properties?.id;
    if (featureId === undefined || featureId === null) return;
    const serverId = String(featureId);
    // Rendered tile geometry is clipped to the tile and quantized; the API has
    // the full feature, so it is the only safe basis for reshaping (rule F4).
    let source;
    try {
      source = await featuresApi.get(serverId);
    } catch (error) {
      if (isMissing(error)) {
        await this.handleMissingFeature(t('featureMissingSelect'));
        return;
      }
      console.error('Unable to load feature, falling back to tile geometry', error);
      source = feature;
    }
    this.selected = {
      serverId,
      geometry: source.geometry,
      properties: { ...source.properties },
    };
    this.showFeaturePanel();
    this.elements['delete-feature'].disabled = !this.editingEnabled;
    this.beginGeometryEditing(serverId, source.geometry);
  }

  async handleMissingFeature(message) {
    this.draw.clear();
    this.clearSelection();
    this.refreshEditorTiles();
    await this.refreshEditorData();
    this.setStatus(message);
  }

  isEditingFeature(featureId) {
    if (featureId === undefined || featureId === null) return false;
    const serverId = String(featureId);
    return this.selected?.serverId === serverId
      && this.draw.getSnapshot().some((feature) => String(feature.properties?.serverId) === serverId);
  }

  beginGeometryEditing(serverId, geometry) {
    if (!this.editingEnabled) return;
    const normalized = normalizeGeometry(geometry);
    if (!normalized) {
      this.setStatus(t('geometryNotReshapable'), true);
      return;
    }
    this.draw.clear();
    const drawId = this.draw.getFeatureId();
    const validation = this.draw.addFeatures([{
      type: 'Feature',
      id: drawId,
      geometry: normalized,
      properties: { serverId, mode: drawingModeForGeometry(normalized) },
    }]);
    if (validation.some((result) => !result.valid)) {
      this.setStatus(t('geometryNotEditable'), true);
      return;
    }
    this.draw.selectFeature(drawId);
    this.draw.setMode('select');
    if (this.selected?.properties?.feature_type === 'road') {
      this.roadEditSession.begin(serverId, normalized);
      this.setInteractionState('editing');
    } else {
      this.roadEditSession.clear();
      this.setInteractionState(null);
    }
    this.updateSnapIndicator(undefined);
  }

  async copyBaseFeatureToEditor(feature) {
    const sourceLayer = feature.sourceLayer || 'basemap';
    const baseIdentity = feature.id === undefined || feature.id === null
      ? null
      : `${sourceLayer}:${feature.id}`;
    if (baseIdentity && this.pendingBaseCopies.has(baseIdentity)) return;
    if (baseIdentity) this.pendingBaseCopies.add(baseIdentity);

    try {
      const existing = await this.findExistingBaseCopy(sourceLayer, feature.id);
      if (existing) {
        await this.selectRenderedFeature(existing);
        this.setStatus(t('baseCopySelected'));
        return;
      }

      const geometry = normalizeGeometry(feature.geometry);
      if (!geometry) {
        this.setStatus(t('baseCopyGeometryFailed'), true);
        return;
      }

      const featureType = this.baseFeatureType(sourceLayer);
      const sourceProperties = Object.fromEntries(
        Object.entries(feature.properties || {}).filter(([, value]) =>
          value === null || ['string', 'number', 'boolean'].includes(typeof value)),
      );
      const name = sourceProperties['name:latin'] || sourceProperties.name || this.featureTypeLabel(featureType);
      const payload = {
        name,
        description: `Editable local copy of ${sourceLayer} from the OSM basemap`,
        geometry,
        properties: {
          ...extraProperties(sourceProperties),
          base_source: 'osm_base',
          base_source_layer: sourceLayer,
          base_feature_id: feature.id ?? null,
        },
        building_type: featureType === 'building' ? (sourceProperties.class || null) : null,
        source_kind: 'manual',
        feature_type: featureType,
        road_type: featureType === 'road' ? (sourceProperties.class || null) : null,
      };

      const saved = await featuresApi.create(payload);
      this.pushUndo(
        () => featuresApi.remove(saved.id, { confirmPublished: true }),
        { roadMutation: featureType === 'road' },
      );
      this.adoptSavedFeature(saved);
      this.showFeaturePanel();
      this.beginGeometryEditing(String(saved.id), saved.geometry);
      this.refreshEditorTiles();
      await this.refreshEditorData();
      this.setStatus(t('baseCopyCreated'));
    } catch (error) {
      console.error('Unable to create editable basemap copy', error);
      this.setStatus(t('baseCopyFailed'), true);
    } finally {
      if (baseIdentity) this.pendingBaseCopies.delete(baseIdentity);
    }
  }

  async findExistingBaseCopy(sourceLayer, featureId) {
    try {
      const collection = await featuresApi.list();
      return collection.features.find((candidate) =>
        candidate.properties?.base_source === 'osm_base'
        && candidate.properties?.base_source_layer === sourceLayer
        && String(candidate.properties?.base_feature_id) === String(featureId),
      ) || null;
    } catch {
      return null;
    }
  }

  baseFeatureType(sourceLayer) {
    return {
      building: 'building',
      transportation: 'road',
      waterway: 'waterway',
      poi: 'poi',
    }[sourceLayer] || 'manual';
  }

  featureTypeOptions(geometryType) {
    return {
      Point: [['point', t('typePoint')], ['poi', t('typePoi')], ['business', t('typeBusiness')]],
      LineString: [['line', t('typeLine')], ['road', t('typeRoad')], ['waterway', t('typeWaterway')]],
      Polygon: [
        ['area', t('typeArea')], ['building', t('typeBuilding')], ['landuse', t('typeLanduse')],
        ['park', t('typePark')], ['water', t('typeWater')], ['forest', t('typeForest')],
        ['grass', t('typeGrass')],
      ],
    }[geometryType] || [['manual', t('typeFeature')]];
  }

  featureTypeLabel(featureType) {
    return String(featureType || 'feature').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  setFeatureTypeOptions(geometryType, currentType) {
    const options = this.featureTypeOptions(geometryType);
    if (currentType && !options.some(([value]) => value === currentType)) {
      options.unshift([currentType, this.featureTypeLabel(currentType)]);
    }
    const select = this.elements['feature-type'];
    select.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
    select.value = currentType || options[0][0];
  }

  showFeaturePanel() {
    if (!this.selected) return;
    const properties = this.selected.properties || {};
    const geometryType = this.selected.geometry?.type || 'Feature';
    this.elements['feature-geometry'].textContent = t('featureMeta', { type: geometryType });
    const createdBy = this.auth?.userName(properties.created_by);
    const updatedBy = this.auth?.userName(properties.updated_by);
    this.elements['feature-audit'].textContent = (createdBy || updatedBy)
      ? t('featureAudit', { created: createdBy || '—', edited: updatedBy || '—' })
      : '';
    this.elements['feature-name'].value = properties.name || '';
    this.elements['feature-description'].value = properties.description || '';
    this.elements['feature-icon'].value = properties.icon || '';
    this.setFeatureTypeOptions(geometryType, properties.feature_type);
    this.elements['building-type'].value = properties.building_type || '';
    this.elements['building-number'].value = properties.building_number || '';
    this.elements['building-height'].value = properties.height_m ?? '';
    this.setSelectValue('road-type', properties.road_type);
    this.elements['road-access'].value = properties.routing_access || '';
    this.elements['road-direction'].value = properties.direction || '';
    this.setSelectValue('lane-count', properties.lane_count);
    this.elements['max-speed'].value = properties.max_speed ?? '';
    updateRoadSpeedControl(this.elements, properties.road_type, { applyDefault: false });
    this.setSelectValue('road-surface', properties.surface);
    this.elements['business-type'].value = properties.business_type || '';
    this.elements['business-floor'].value = properties.floor || '';
    this.elements['business-phone'].value = properties.phone || '';
    this.elements['business-hours'].value = properties.opening_hours || '';
    this.renderBuildingBusinesses();
    this.updatePropertyFieldVisibility();
    this.updateSelectedRoadConnectivityHint();
    this.elements['delete-feature'].disabled = !this.editingEnabled;
    this.elements['duplicate-feature'].disabled = !this.editingEnabled;
    this.elements['feature-panel'].hidden = false;
  }

  updatePropertyFieldVisibility() {
    const featureType = this.elements['feature-type'].value;
    this.elements['building-fields'].hidden = featureType !== 'building';
    this.elements['road-fields'].hidden = featureType !== 'road';
    this.elements['business-fields'].hidden = featureType !== 'business';
    if (featureType === 'road') {
      updateRoadSpeedControl(this.elements, this.elements['road-type'].value, { applyDefault: false });
    }
  }

  // A new drawing reads the form for its initial payload, so leftover values
  // from a previously selected feature must never linger (rule F5).
  resetFeatureForm() {
    for (const id of FORM_FIELDS) this.elements[id].value = '';
    this.elements['feature-type'].replaceChildren();
    this.elements['feature-geometry'].textContent = '';
  }

  clearSelection() {
    this.selected = null;
    this.roadEditSession.clear();
    this.pendingDrawFeatureType = null;
    this.pendingRoadType = null;
    this.resetFeatureForm();
    this.elements['feature-panel'].hidden = true;
    this.elements['delete-feature'].disabled = true;
    this.elements['duplicate-feature'].disabled = true;
    this.updateSnapIndicator(undefined);
    this.setInteractionState(null);
  }

  currentSelectedGeometry() {
    if (!this.selected) return null;
    return this.roadEditSession.geometry(this.selected.serverId) || this.selected.geometry;
  }

  makeFeaturePayload(geometry, previousProperties = {}) {
    const { mode, serverId, ...storedProperties } = previousProperties;
    const name = this.elements['feature-name'].value.trim();
    const description = this.elements['feature-description'].value.trim();
    const icon = this.elements['feature-icon'].value.trim() || null;
    const featureType = this.elements['feature-type'].value
      || previousProperties.feature_type
      || this.pendingDrawFeatureType
      || this.featureTypeOptions(geometry.type)[0][0];
    const buildingType = featureType === 'building' ? (this.elements['building-type'].value || null) : null;
    const buildingNumber = featureType === 'building' ? (this.elements['building-number'].value.trim() || null) : null;
    const heightM = featureType === 'building'
      ? this.floatFieldValue('building-height')
      : (previousProperties.height_m ?? null);
    const roadType = featureType === 'road'
      ? (this.elements['road-type'].value || this.pendingRoadType || null)
      : null;
    const direction = featureType === 'road' ? (this.elements['road-direction'].value || null) : null;
    const laneCount = featureType === 'road' ? this.integerFieldValue('lane-count') : null;
    const vehicleRoad = isVehicleRoadType(roadType);
    const maxSpeed = featureType === 'road' && vehicleRoad
      ? this.integerFieldValue('max-speed')
      : (featureType === 'road' && previousProperties.road_type === roadType
        ? (previousProperties.max_speed ?? null)
        : null);
    const surface = featureType === 'road' ? (this.elements['road-surface'].value || null) : null;
    const businessType = featureType === 'business' ? (this.elements['business-type'].value || null) : null;
    const sourceKind = previousProperties.source_kind || 'manual';
    const extras = extraProperties(storedProperties);
    if (featureType === 'business') this.applyBusinessExtras(extras);
    if (featureType === 'road') {
      const routingAccess = this.elements['road-access'].value;
      if (routingAccess) extras.routing_access = routingAccess;
      else delete extras.routing_access;
    } else {
      delete extras.routing_access;
    }
    return {
      name,
      description,
      geometry,
      properties: extras,
      building_type: buildingType,
      building_number: buildingNumber,
      icon,
      source_kind: sourceKind,
      feature_type: featureType,
      osm_id: previousProperties.osm_id || null,
      osm_type: previousProperties.osm_type || null,
      height_m: heightM,
      road_type: roadType,
      direction,
      lane_count: laneCount,
      max_speed: maxSpeed,
      surface,
      business_type: businessType,
      building_id: previousProperties.building_id ?? null,
    };
  }

  // Business extras live in the JSONB properties blob, not in columns.
  applyBusinessExtras(extras) {
    const fields = { floor: 'business-floor', phone: 'business-phone', opening_hours: 'business-hours' };
    for (const [key, elementId] of Object.entries(fields)) {
      const value = this.elements[elementId].value.trim();
      if (value) extras[key] = value;
      else delete extras[key];
    }
  }

  integerFieldValue(elementId) {
    const value = this.elements[elementId].value;
    return value === '' ? null : Number.parseInt(value, 10);
  }

  floatFieldValue(elementId) {
    const value = this.elements[elementId].value;
    if (value === '') return null;
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  // Rebuilds a full API payload from stored data without reading the form,
  // so undo can restore a feature exactly as it was (rule F9).
  rawFeaturePayload(geometry, properties) {
    const p = properties || {};
    return {
      name: p.name || '',
      description: p.description || '',
      geometry,
      properties: extraProperties(p),
      building_type: p.building_type ?? null,
      building_number: p.building_number ?? null,
      icon: p.icon ?? null,
      source_kind: p.source_kind || 'manual',
      feature_type: p.feature_type ?? null,
      osm_id: p.osm_id ?? null,
      osm_type: p.osm_type ?? null,
      height_m: p.height_m ?? null,
      road_type: p.road_type ?? null,
      direction: p.direction ?? null,
      lane_count: p.lane_count ?? null,
      max_speed: p.max_speed ?? null,
      surface: p.surface ?? null,
      business_type: p.business_type ?? null,
      building_id: p.building_id ?? null,
    };
  }

  pushUndo(revert, { roadMutation = false } = {}) {
    this.undoStack.push({ revert, roadMutation });
    if (this.undoStack.length > 50) this.undoStack.shift();
  }

  async undoLast() {
    if (!this.editingEnabled) return;
    if (this.selected?.properties?.feature_type === 'road') {
      const geometry = this.roadEditSession.undoDraft(this.selected.serverId);
      if (geometry) {
        const drawFeature = this.draw.getSnapshot().find((feature) =>
          String(feature.properties?.serverId) === this.selected.serverId);
        if (drawFeature) this.draw.updateFeatureGeometry(drawFeature.id, geometry);
        this.updateRoadConnectivity(this.visibleFeatures);
        this.setStatus(t('roadDraftUndo'));
        return;
      }
    }
    const entry = this.undoStack.pop();
    if (!entry) {
      this.setStatus(t('nothingToUndo'));
      return;
    }
    try {
      await entry.revert();
      this.draw.clear();
      this.clearSelection();
      this.refreshEditorTiles();
      await this.refreshEditorData();
      if (entry.roadMutation) this.markRoadNetworkStale();
      this.setStatus(t('undoDone'));
    } catch (error) {
      console.error('Unable to undo', error);
      this.setStatus(t('undoFailed'), true);
    }
  }

  async duplicateSelected() {
    if (!this.editingEnabled || !this.selected) return;
    // A duplicate is a fresh manual feature: it must not mask a basemap
    // original or claim the source feature's OSM identity.
    const {
      base_source, base_source_layer, base_feature_id, osm_id, osm_type, ...properties
    } = this.selected.properties || {};
    const payload = this.rawFeaturePayload(
      offsetGeometry(this.currentSelectedGeometry()),
      { ...properties, source_kind: 'manual' },
    );
    try {
      const saved = await featuresApi.create(payload);
      const isRoad = saved.feature_type === 'road';
      this.pushUndo(
        () => featuresApi.remove(saved.id, { confirmPublished: true }),
        { roadMutation: isRoad },
      );
      this.adoptSavedFeature(saved);
      this.showFeaturePanel();
      this.beginGeometryEditing(String(saved.id), saved.geometry);
      this.refreshEditorTiles();
      await this.refreshEditorData();
      if (isRoad) this.markRoadNetworkStale();
      this.setStatus(t('duplicated'));
    } catch (error) {
      console.error('Unable to duplicate feature', error);
      this.setStatus(t('duplicateFailed'), true);
    }
  }

  // MapLibre auto-suppresses the native context menu as soon as any
  // 'contextmenu' map listener exists, and browsers withhold that DOM event
  // after a right-click-*drag* — so right-click-drag camera rotation
  // (MapLibre's default dragRotate) still reaches this map unaffected; only a
  // stationary right-click ever gets here.
  handleContextMenu(event) {
    if (!this.editingEnabled || !this.selected) return;
    const reach = 6;
    const clickBox = [
      [event.point.x - reach, event.point.y - reach],
      [event.point.x + reach, event.point.y + reach],
    ];
    const rendered = this.map.queryRenderedFeatures(clickBox, { layers: this.interactiveLayers });
    const hitSelected = rendered.some((feature) =>
      String(feature.id ?? feature.properties?.id) === this.selected.serverId);
    if (!hitSelected) return;
    this.featureMenu.open(event.originalEvent.clientX, event.originalEvent.clientY, this.selected.geometry?.type);
  }

  handleFeatureMenuOperation(op) {
    if (op === 'copy') { this.duplicateSelected(); return; }
    if (op === 'delete') { this.deleteSelected(); return; }
    const transform = { circularise, square: orthogonalize, flipLong, flipShort }[op];
    if (transform) this.applyGeometryTransform(transform);
  }

  // Circularise/Square/Flip only reshape the geometry; everything else about
  // the feature is carried over unchanged, same as saveProperties.
  async applyGeometryTransform(transform) {
    if (!this.editingEnabled || !this.selected) return;
    const serverId = this.selected.serverId;
    const previous = { geometry: this.selected.geometry, properties: { ...this.selected.properties } };
    let geometry = transform(this.currentSelectedGeometry());
    if (!geometry) {
      this.setStatus(t('geometryOpFailed'), true);
      return;
    }
    const isRoad = previous.properties.feature_type === 'road';
    if (isRoad) {
      geometry = snapRoadEndpoints(geometry, this.roadSegmentIndex, serverId);
      const validation = validateRoadLineString(geometry);
      if (!validation.valid) {
        this.setStatus(t(validation.reason), true);
        return;
      }
      this.roadEditSession.stage(geometry);
      const drawFeature = this.draw.getSnapshot().find((feature) =>
        String(feature.properties?.serverId) === serverId);
      if (drawFeature) this.draw.updateFeatureGeometry(drawFeature.id, geometry);
      this.updateRoadConnectivity(this.visibleFeatures);
      this.setStatus(t('roadGeometryDraft'));
      return;
    }
    try {
      const saved = await featuresApi.update(serverId, this.rawFeaturePayload(geometry, previous.properties));
      this.pushUndo(
        () => featuresApi.update(serverId, this.rawFeaturePayload(previous.geometry, previous.properties)),
        { roadMutation: isRoad },
      );
      this.adoptSavedFeature(saved);
      this.refreshEditorTiles();
      await this.refreshEditorData();
      this.beginGeometryEditing(serverId, saved.geometry);
      this.setStatus(t('geometryOpApplied'));
    } catch (error) {
      if (isMissing(error)) {
        await this.handleMissingFeature(t('featureMissingSave'));
        return;
      }
      console.error('Unable to apply geometry operation', error);
      this.setStatus(t('geometryOpFailed'), true);
    }
  }

  // The businesses list renders only while its building stays selected; the
  // fetch result for a superseded selection is dropped.
  async renderBuildingBusinesses() {
    const list = this.elements['building-businesses'];
    const selected = this.selected;
    const isSavedBuilding = selected?.properties?.feature_type === 'building' && selected?.serverId;
    const showEmpty = () => {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = t('businessesEmpty');
      list.replaceChildren(empty);
    };
    showEmpty();
    this.elements['add-business'].disabled = !this.editingEnabled || !isSavedBuilding;
    if (!isSavedBuilding) return;
    try {
      const collection = await featuresApi.businesses(selected.serverId);
      if (this.selected !== selected) return;
      if (!collection.features.length) return;
      list.replaceChildren(...collection.features.map((feature) => {
        const item = document.createElement('li');
        const open = document.createElement('button');
        open.type = 'button';
        const icon = feature.properties?.icon || '';
        open.textContent = `${icon} ${feature.properties?.name || t('businessUnnamed')}`.trim();
        open.addEventListener('click', () => {
          this.map.flyTo({
            center: feature.geometry.coordinates,
            zoom: Math.max(this.map.getZoom(), 17),
            essential: true,
          });
          this.selectRenderedFeature(feature);
        });
        item.append(open);
        return item;
      }));
    } catch (error) {
      console.error('Unable to load building businesses', error);
    }
  }

  async addBusinessToBuilding() {
    if (!this.editingEnabled || !this.selected?.serverId) return;
    const buildingId = Number(this.selected.serverId);
    if (!Number.isInteger(buildingId)) return;
    const [[west, south], [east, north]] = geometryBounds(this.selected.geometry);
    try {
      const saved = await featuresApi.create({
        name: '',
        description: '',
        geometry: { type: 'Point', coordinates: [(west + east) / 2, (south + north) / 2] },
        properties: {},
        source_kind: 'manual',
        feature_type: 'business',
        icon: BUSINESS_ICONS.shop,
        building_id: buildingId,
      });
      this.pushUndo(() => featuresApi.remove(saved.id));
      this.adoptSavedFeature(saved);
      this.showFeaturePanel();
      this.beginGeometryEditing(String(saved.id), saved.geometry);
      this.refreshEditorTiles();
      await this.refreshEditorData();
      this.setStatus(t('businessAdded'));
    } catch (error) {
      console.error('Unable to add business', error);
      this.setStatus(t('businessAddFailed'), true);
    }
  }

  mergeFeatureProperties(feature) {
    return {
      ...feature.properties,
      name: feature.name,
      description: feature.description,
      building_type: feature.building_type,
      building_number: feature.building_number,
      icon: feature.icon,
      source_kind: feature.source_kind,
      feature_type: feature.feature_type,
      osm_id: feature.osm_id,
      osm_type: feature.osm_type,
      height_m: feature.height_m,
      business_type: feature.business_type,
      building_id: feature.building_id,
      road_type: feature.road_type,
      direction: feature.direction,
      lane_count: feature.lane_count,
      max_speed: feature.max_speed,
      surface: feature.surface,
    };
  }

  async saveProperties() {
    if (!this.selected) return;
    const serverId = this.selected.serverId;
    const previous = { geometry: this.selected.geometry, properties: { ...this.selected.properties } };
    const geometry = this.currentSelectedGeometry();
    const isRoad = this.selected.properties?.feature_type === 'road'
      || this.elements['feature-type'].value === 'road';
    if (isRoad) {
      const validation = validateRoadLineString(geometry);
      if (!validation.valid) {
        this.setStatus(t(validation.reason), true);
        return;
      }
    }
    try {
      const saved = await featuresApi.update(serverId, this.makeFeaturePayload(geometry, this.selected.properties));
      this.pushUndo(
        () => featuresApi.update(serverId, this.rawFeaturePayload(previous.geometry, previous.properties)),
        { roadMutation: isRoad },
      );
      this.adoptSavedFeature(saved);
      this.refreshEditorTiles();
      await this.refreshEditorData();
      this.showFeaturePanel();
      this.beginGeometryEditing(serverId, saved.geometry);
      if (isRoad) {
        this.markRoadNetworkStale();
        this.setStatus(t('roadUpdated', { connected: this.selectedRoadConnectedEnds(), total: 2 }));
      } else {
        this.setStatus(t('propertiesSaved'));
      }
    } catch (error) {
      if (isMissing(error)) {
        await this.handleMissingFeature(t('featureMissingSave'));
        return;
      }
      console.error('Unable to save properties', error);
      this.setStatus(t('propertiesSaveFailed'), true);
    }
  }

  async deleteSelected() {
    if (!this.editingEnabled || !this.selected) return;
    // Copies of basemap objects and OSM imports both shadow map data that
    // would otherwise reappear, so their delete keeps a tombstone row.
    const properties = this.selected.properties || {};
    const isBaseCopy = (properties.base_feature_id !== undefined && properties.base_feature_id !== null)
      || (properties.source_kind === 'osm_import' && Boolean(properties.osm_id));
    const serverId = this.selected.serverId;
    const snapshot = { geometry: this.selected.geometry, properties: { ...this.selected.properties } };
    const isRoad = properties.feature_type === 'road';
    const deleteButton = this.elements['delete-feature'];
    deleteButton.disabled = true;
    try {
      let confirmPublished = false;
      while (true) {
        try {
          if (isBaseCopy) {
            // The copy becomes a tombstone instead of a deleted row, so the
            // read-only basemap original stays masked.
            await featuresApi.update(
              serverId,
              { source_kind: 'base_tombstone' },
              { confirmPublished },
            );
          } else {
            await featuresApi.remove(serverId, { confirmPublished });
          }
          break;
        } catch (error) {
          const needsConfirmation = error instanceof ApiError
            && error.status === 409
            && error.message === 'published_road_confirmation_required';
          if (!needsConfirmation) throw error;
          if (!window.confirm(t('publishedRoadDeleteConfirm'))) {
            this.setStatus(t('deleteCancelled'));
            return;
          }
          confirmPublished = true;
        }
      }
      this.pushUndo(
        isBaseCopy
          ? () => featuresApi.update(serverId, { source_kind: snapshot.properties.source_kind || 'manual' })
          : () => featuresApi.create(this.rawFeaturePayload(snapshot.geometry, snapshot.properties)),
        { roadMutation: isRoad },
      );
      this.draw.clear();
      this.clearSelection();
      this.refreshEditorTiles();
      await this.refreshEditorData();
      if (isRoad) this.markRoadNetworkStale();
      this.setStatus(isBaseCopy ? t('baseObjectRemoved') : t('featureDeleted'));
    } catch (error) {
      if (isMissing(error)) {
        await this.handleMissingFeature(t('featureMissingDelete'));
        return;
      }
      console.error('Unable to delete feature', error);
      this.setStatus(t('deleteFailed'), true);
    } finally {
      if (this.selected) deleteButton.disabled = !this.editingEnabled;
    }
  }

  refreshEditorTiles() {
    this.editorRevision += 1;
    this.map.getSource('editor')?.setTiles([`/tiles/editor/{z}/{x}/{y}?revision=${this.editorRevision}`]);
  }

  markRoadNetworkStale() {
    this.roadNetwork.markStale();
    this.route.invalidateNetwork();
  }

  async refreshEditorData() {
    if (this.fullBase) return this.refreshViewportData();
    try {
      const collection = await featuresApi.list();
      const visible = collection.features.filter((feature) => feature.properties?.source_kind !== 'base_tombstone');
      this.visibleFeatures = visible;
      this.elements['feature-count'].textContent = visible.length;
      applyBaseFeatureMasks(this.map, this.baseFilters, collection.features);
      this.map.getSource('editor_anchors')?.setData(featureAnchors(collection.features));
      this.snapVertices = collectVertices(visible);
      this.updateRoadConnectivity(visible);
      this.renderHiddenObjects(
        collection.features.filter((feature) => feature.properties?.source_kind === 'base_tombstone'),
      );
    } catch (error) {
      console.error('Unable to load editor data', error);
      this.elements['feature-count'].textContent = '—';
    }
  }

  // Country scale: render from tiles, and fetch only the viewport's features
  // for snapping, and only when zoomed in enough to edit them (rule F4).
  async refreshViewportData() {
    if (this.totalFeatureCount != null) {
      this.elements['feature-count'].textContent = this.totalFeatureCount;
    }
    if (this.map.getZoom() < EDIT_ZOOM) {
      this.snapVertices = [];
      this.visibleFeatures = [];
      this.updateRoadConnectivity([]);
      return;
    }
    try {
      const bounds = this.map.getBounds();
      const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(',');
      const collection = await featuresApi.listInBounds(bbox, VIEWPORT_FEATURE_LIMIT);
      const visible = collection.features.filter((feature) => feature.properties?.source_kind !== 'base_tombstone');
      this.visibleFeatures = visible;
      this.snapVertices = collectVertices(visible);
      this.updateRoadConnectivity(visible);
    } catch (error) {
      console.error('Unable to load viewport features', error);
      this.snapVertices = [];
      this.visibleFeatures = [];
      this.updateRoadConnectivity([]);
    }
  }

  // Green/red endpoint markers use the same segment index as drawing snaps and
  // therefore preview the manual junctions the next graph rebuild will create.
  updateRoadConnectivity(features) {
    const roads = features
      .filter((feature) => feature.properties?.feature_type === 'road')
      .map((feature) => ({ ...feature }));
    if (this.selected?.properties?.feature_type === 'road') {
      const selectedRoad = {
        id: this.selected.serverId,
        geometry: this.currentSelectedGeometry(),
        properties: this.selected.properties,
      };
      const existingIndex = roads.findIndex((feature) => String(feature.id) === this.selected.serverId);
      if (existingIndex === -1) roads.push(selectedRoad);
      else roads[existingIndex] = selectedRoad;
    }
    this.roadSegmentIndex = RoadSegmentIndex.fromFeatures(roads);
    this.roadConnectivityMarkers = roadConnectivity(roads, this.roadSegmentIndex);
    this.map.getSource('road_connectivity')?.setData({
      type: 'FeatureCollection',
      features: this.roadConnectivityMarkers,
    });
    this.updateSelectedRoadConnectivityHint();
  }

  selectedRoadConnectedEnds() {
    if (!this.selected || this.selected.properties?.feature_type !== 'road') return 0;
    return this.roadConnectivityMarkers
      .filter((marker) => marker.properties.road_id === this.selected.serverId && marker.properties.connected)
      .length;
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

  renderHiddenObjects(tombstones) {
    const list = this.elements['hidden-objects'];
    if (!tombstones.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = t('hiddenObjectsEmpty');
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...tombstones.map((feature) => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = feature.properties?.name || t('objectFallbackName', { id: feature.id });
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.textContent = t('restore');
      restore.addEventListener('click', () => this.restoreHiddenObject(feature));
      item.append(label, restore);
      return item;
    }));
  }

  async restoreHiddenObject(feature) {
    try {
      try {
        await featuresApi.remove(feature.id, { confirmPublished: true });
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      this.pushUndo(
        () => featuresApi.create(this.rawFeaturePayload(feature.geometry, feature.properties)),
        { roadMutation: feature.properties?.feature_type === 'road' },
      );
      this.refreshEditorTiles();
      await this.refreshEditorData();
      if (feature.properties?.feature_type === 'road') this.markRoadNetworkStale();
      this.setStatus(t('baseObjectRestored'));
    } catch (error) {
      console.error('Unable to restore basemap object', error);
      this.setStatus(t('restoreFailed'), true);
    }
  }

  // Search runs in SQL (rule B6) so it works identically over a handful of
  // edits or the whole country without holding every name in the browser.
  async jumpToFeature(query) {
    const needle = query.trim();
    if (!needle) return;
    let feature;
    try {
      feature = (await featuresApi.search(needle, 1)).features[0];
    } catch (error) {
      console.error('Unable to search features', error);
      this.setStatus(t('searchMiss', { query: needle }), true);
      return;
    }
    if (!feature) {
      this.setStatus(t('searchMiss', { query: needle }), true);
      return;
    }
    if (feature.geometry.type === 'Point') {
      this.map.flyTo({ center: feature.geometry.coordinates, zoom: 17, essential: true });
    } else {
      this.map.fitBounds(geometryBounds(feature.geometry), { padding: 80, maxZoom: 18, essential: true });
    }
    this.setStatus(t('searchHit', { name: feature.properties.name }));
  }

  async populateSearchOptions(query) {
    try {
      const collection = await featuresApi.search(query, 8);
      const names = [...new Set(collection.features.map((feature) => feature.properties?.name).filter(Boolean))];
      this.elements['feature-search-options'].replaceChildren(...names.map((name) => new Option(name)));
    } catch (error) {
      // Type-ahead is best-effort; a failed lookup just shows no suggestions.
    }
  }

  snapToEditorTarget(event, context) {
    const best = this.nearestSnapCoordinate(event.lng, event.lat, context);
    this.updateSnapIndicator(best);
    return best;
  }

  nearestSnapVertex(lng, lat) {
    // Snap radius shrinks with zoom so it stays roughly constant on screen.
    const threshold = (360 / (2 ** this.map.getZoom() * 512)) * 14;
    let best;
    let bestDistance = threshold * threshold;
    for (const [vLng, vLat] of this.snapVertices) {
      const dLng = (vLng - lng) * Math.cos((lat * Math.PI) / 180);
      const dLat = vLat - lat;
      const distance = dLng * dLng + dLat * dLat;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = [vLng, vLat];
      }
    }
    return best;
  }

  nearestSnapCoordinate(lng, lat, context) {
    const roadEditing = this.draw.getMode() === 'linestring'
      || this.selected?.properties?.feature_type === 'road';
    if (!roadEditing) return this.nearestSnapVertex(lng, lat);
    const editingExistingRoad = this.draw.getMode() === 'select'
      && this.selected?.properties?.feature_type === 'road';
    if (!canSnapRoadCoordinate(context, editingExistingRoad)) return undefined;
    // Project onto the nearest point anywhere along another saved road. Eight
    // metres is the shared UI/builder maximum and self-snaps are excluded.
    const excludedOwner = editingExistingRoad ? this.selected?.serverId : null;
    return this.roadSegmentIndex.nearestCoordinate(
      lng, lat, ROAD_SNAP_DEGREES, excludedOwner,
    );
  }

  // Terra Draw's own toCustom snapping drives the ring while it fires, but it
  // is only guaranteed to run at coordinate-commit points; this native
  // listener is the fallback that guarantees the ring tracks the cursor on
  // every hover, not just on click, while a new shape is being drawn.
  previewSnapWhileDrawing(event) {
    if (!this.editingEnabled || this.draw.getMode() === 'select') return;
    this.updateSnapIndicator(this.nearestSnapCoordinate(event.lngLat.lng, event.lngLat.lat));
  }

  // Live feedback for "is the point I'm about to place connected to a road":
  // Terra Draw calls snapToEditorTarget continuously while the pointer moves
  // during a draw, so this paints a ring at the live snap target the moment
  // one is in range — before the point is even placed.
  updateSnapIndicator(coordinate) {
    const key = coordinate ? coordinate.join(',') : null;
    if (key === this.snapIndicatorKey) return;
    this.snapIndicatorKey = key;
    this.map.getSource('snap_indicator')?.setData({
      type: 'FeatureCollection',
      features: coordinate
        ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: coordinate }, properties: {} }]
        : [],
    });
  }

  setImportedLayerVisibility(visible) {
    setLayerVisibility(this.map, IMPORT_LAYERS, visible);
  }

  // The Import popup lists every OSM layer that can be pulled for the focused
  // area; its header shows the map centre so it is clear the import is
  // viewport-scoped, not global.
  toggleImportPopup() {
    const popup = this.elements['import-popup'];
    if (popup.hidden) {
      const centre = this.map.getCenter();
      this.elements['import-area'].textContent = t('importAreaHint', {
        lat: centre.lat.toFixed(4), lon: centre.lng.toFixed(4),
      });
    }
    popup.hidden = !popup.hidden;
  }

  async importOSM(kind, button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = t('importing');
    const bounds = this.map.getBounds();
    try {
      const result = await featuresApi.importOsm(kind, {
        west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth(),
      });
      this.elements['toggle-imports'].checked = true;
      this.setImportedLayerVisibility(true);
      this.refreshEditorTiles();
      await this.refreshEditorData();
      if (kind === 'roads' && result.roads_loaded > 0) this.markRoadNetworkStale();
      this.setStatus(result.message);
    } catch (error) {
      console.error(`Unable to import ${kind}`, error);
      this.setStatus(t('importFailed', { kind: t(IMPORT_KIND_KEYS[kind] ?? kind), message: error.message }), true);
    } finally {
      button.textContent = original;
      button.disabled = false;
    }
  }

  async clearAll() {
    if (!window.confirm(t('clearAllConfirm'))) return;
    const hadRoads = this.roadSegmentIndex.cells.size > 0 || this.roadSegmentIndex.longSegments.length > 0;
    try {
      await featuresApi.clearAll();
      this.draw.clear();
      this.clearSelection();
      this.refreshEditorTiles();
      await this.refreshEditorData();
      if (hadRoads) this.markRoadNetworkStale();
      this.setStatus(t('cleared'));
    } catch (error) {
      console.error('Unable to clear editor data', error);
      this.setStatus(t('clearFailed'), true);
    }
  }

  goToUserLocation() {
    if (!navigator.geolocation) {
      this.setStatus(t('geolocationUnsupported'), true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => this.map.flyTo({ center: [position.coords.longitude, position.coords.latitude], zoom: 15, essential: true }),
      () => this.setStatus(t('geolocationFailed'), true),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
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
