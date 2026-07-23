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
import { featuresApi } from './api.js';
import { EDITOR_3D_LAYER } from './basemap-render.js';
import { normalizeGeometry } from './geometry.js';
import { moveRoadBendVertex, RoadBendGesture } from './road-bending.js';
import {
  ROAD_SNAP_DEGREES,
  validateRoadLineString,
} from './road-editing.js';
import {
  sameRoadSpan,
  selectedRoadSpanSelection,
} from './road-guidance.js';
import {
  BASE_EDITABLE_LAYERS,
  setLayerVisibility,
} from './layers.js';
import { t } from './strings.js';

const DRAW_MODE_BUTTONS = {
  point: 'draw-point',
  linestring: 'draw-line',
  polygon: 'draw-polygon',
  rectangle: 'draw-rect',
  circle: 'draw-circle',
  select: 'select',
};

export class EditorInteractions {
  constructor(editor) {
    this.editor = editor;
    this.roadBend = null;
    this.viewportTimer = null;
    this.roadPrepareTimer = null;
    this.preparedRoadAreas = [];
    this.preparingRoads = false;
    this.roadPrepareCooldown = 0;
  }

  createDrawing() {
    const editor = this.editor;
    const adapter = new TerraDrawMapLibreGLAdapter({
      map: editor.map,
      prefixId: 'editor-draw',
    });
    const snapping = {
      toCustom: (event, context) => editor.snapping.target(event, context),
    };
    const editableCoordinates = {
      draggable: true,
      midpoints: true,
      deletable: true,
      snappable: snapping,
    };
    editor.draw = new TerraDraw({
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
            linestring: {
              feature: {
                draggable: true,
                rotateable: true,
                scaleable: true,
                coordinates: editableCoordinates,
              },
            },
            polygon: {
              feature: {
                draggable: true,
                rotateable: true,
                scaleable: true,
                coordinates: editableCoordinates,
              },
            },
          },
        }),
      ],
    });
    editor.draw.on(
      'finish',
      (id) => editor.featureEditor.persistFinishedDraw(id),
    );
    editor.draw.start();
    editor.draw.setMode('select');
    this.installRoadBending();
  }

  installRoadBending() {
    const editor = this.editor;
    this.roadBend?.destroy();
    this.roadBend = new RoadBendGesture({
      map: editor.map,
      getRoad: () => this.bendableRoad(),
      onPreview: (change) => this.previewRoadBend(change),
      onCommit: (change) => this.commitRoadBend(change),
      onCancel: ({ drawId, geometry }) => {
        if (editor.draw.hasFeature(drawId)) {
          editor.draw.updateFeatureGeometry(drawId, geometry);
        }
        editor.snapping.updateIndicator(undefined);
        editor.updateRoadGuidance();
      },
    });
    this.roadBend.bind();
  }

  bendableRoad() {
    const editor = this.editor;
    if (
      !editor.editingEnabled
      || editor.draw?.getMode() !== 'select'
      || editor.selected?.properties?.feature_type !== 'road'
    ) return null;
    const feature = editor.draw.getSnapshot().find(
      (candidate) => String(candidate.properties?.serverId) === editor.selected.serverId,
    );
    if (feature?.geometry?.type !== 'LineString') return null;
    return { drawId: feature.id, geometry: feature.geometry };
  }

  roadBendPreviewGeometry(geometry, vertexIndex) {
    const editor = this.editor;
    if (vertexIndex !== 0 && vertexIndex !== geometry.coordinates.length - 1) {
      editor.snapping.updateIndicator(undefined);
      return geometry;
    }
    const position = geometry.coordinates[vertexIndex];
    const target = editor.roadSegmentIndex.nearestCoordinate(
      position[0],
      position[1],
      ROAD_SNAP_DEGREES,
      editor.selected?.serverId,
    );
    editor.snapping.updateIndicator(target);
    return target ? moveRoadBendVertex(geometry, vertexIndex, target) : geometry;
  }

  previewRoadBend({ drawId, geometry, vertexIndex }) {
    const editor = this.editor;
    if (!editor.draw.hasFeature(drawId)) return;
    editor.draw.updateFeatureGeometry(
      drawId,
      this.roadBendPreviewGeometry(geometry, vertexIndex),
    );
    editor.updateRoadGuidance();
  }

  commitRoadBend({ drawId, geometry, originalGeometry, vertexIndex }) {
    const editor = this.editor;
    if (!editor.draw.hasFeature(drawId) || !editor.selected) return;
    const committed = this.roadBendPreviewGeometry(geometry, vertexIndex);
    const validation = validateRoadLineString(committed);
    if (!validation.valid) {
      editor.draw.updateFeatureGeometry(drawId, originalGeometry);
      editor.snapping.updateIndicator(undefined);
      editor.updateRoadGuidance();
      editor.setStatus(t(validation.reason), true);
      return;
    }
    editor.draw.updateFeatureGeometry(drawId, committed);
    editor.featureEditor.roadEditSession.stage(committed);
    editor.snapping.updateIndicator(undefined);
    editor.updateRoadConnectivity(editor.visibleFeatures);
    this.setInteractionState('editing');
    editor.setStatus(t('roadGeometryDraft'));
  }

  bindMap() {
    const editor = this.editor;
    editor.map.on('click', async (event) => {
      if (this.roadBend?.consumeMapClick()) return;
      if (editor.route.handleMapClick(event)) return;
      if (editor.draw.getMode() !== 'select') return;

      const reach = 6;
      const clickBox = [
        [event.point.x - reach, event.point.y - reach],
        [event.point.x + reach, event.point.y + reach],
      ];
      const rendered = editor.map.queryRenderedFeatures(
        clickBox,
        { layers: editor.interactiveLayers },
      );
      if (rendered.length) {
        const featureId = rendered[0].id ?? rendered[0].properties?.id;
        const selectionCoordinate = [event.lngLat.lng, event.lngLat.lat];
        if (editor.featureEditor.isEditingFeature(featureId)) {
          if (editor.selected?.properties?.feature_type !== 'road') return;
          const nextSpan = selectedRoadSpanSelection({
            id: editor.selected.serverId,
            geometry: editor.selected.fullGeometry || editor.selected.geometry,
            properties: editor.selected.properties,
          }, editor.roadSegmentIndex, selectionCoordinate);
          if (
            !nextSpan?.partial
            || (
              editor.selected.roadSpan
              && sameRoadSpan(editor.selected.roadSpan, nextSpan)
            )
          ) return;
        }
        await editor.featureEditor.selectRenderedFeature(
          rendered[0],
          selectionCoordinate,
        );
        return;
      }

      if (editor.editingEnabled) {
        const baseFeature = editor.map
          .queryRenderedFeatures(clickBox, { layers: BASE_EDITABLE_LAYERS })
          .find((feature) => normalizeGeometry(feature.geometry));
        if (baseFeature) {
          await editor.featureEditor.copyBaseFeatureToEditor(baseFeature);
          return;
        }
      }

      if (editor.selected) this.cancelSelectedEditing({ announce: false });
      else editor.featureEditor.clearSelection();
    });
    editor.map.on('mousemove', (event) => {
      editor.snapping.previewWhileDrawing(event, editor.editingEnabled);
    });
    editor.map.on('contextmenu', (event) => editor.actions.handleContextMenu(event));
    editor.map.on('moveend', () => this.handleMoveEnd());
    editor.interactiveLayers.forEach((layerId) => {
      editor.map.on('mouseenter', layerId, () => {
        editor.map.getCanvas().style.cursor = 'pointer';
      });
      editor.map.on('mouseleave', layerId, () => {
        editor.map.getCanvas().style.cursor = '';
      });
    });
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) return;
      editor.refreshEditorTiles();
      await editor.refreshEditorData();
    });
  }

  handleMoveEnd() {
    const editor = this.editor;
    if (editor.fullBase) {
      clearTimeout(this.viewportTimer);
      this.viewportTimer = setTimeout(() => editor.refreshEditorData(), 400);
      return;
    }
    if (!editor.editingEnabled) return;
    clearTimeout(this.roadPrepareTimer);
    this.roadPrepareTimer = setTimeout(() => this.prepareViewportRoads(), 1500);
  }

  bindControls() {
    const editor = this.editor;
    const elements = editor.elements;
    elements['toggle-editing'].addEventListener('click', () => this.toggleEditing());
    elements['draw-point'].addEventListener('click', () => this.setDrawMode('point'));
    elements['draw-line'].addEventListener('click', () => this.setDrawMode('linestring'));
    elements['draw-polygon'].addEventListener('click', () => this.setDrawMode('polygon'));
    elements['draw-rect'].addEventListener('click', () => this.setDrawMode('rectangle'));
    elements['draw-circle'].addEventListener('click', () => this.setDrawMode('circle'));
    elements.select.addEventListener('click', () => this.setDrawMode('select'));
    elements['undo-edit'].addEventListener('click', () => editor.actions.undoLast());
    elements['duplicate-feature'].addEventListener('click', () => editor.actions.duplicateSelected());
    elements['delete-feature'].addEventListener('click', () => editor.actions.deleteSelected());
    document.addEventListener('keydown', (event) => this.handleKeydown(event), true);
    elements['save-feature'].addEventListener('click', () => editor.actions.saveProperties());
    elements['cancel-feature'].addEventListener('click', () => this.cancelSelectedEditing());
    elements['close-feature'].addEventListener('click', () => this.cancelSelectedEditing());
    elements['new-road-type'].addEventListener('change', () => this.updateRoadDrawAvailability());
    elements['add-business'].addEventListener('click', () => editor.actions.addBusinessToBuilding());
    elements['toggle-3d'].addEventListener('change', (event) => {
      const layer = editor.fullBase ? EDITOR_3D_LAYER : 'base-buildings-3d';
      setLayerVisibility(editor.map, [layer], event.target.checked);
    });
    elements['clear-all'].addEventListener('click', () => editor.actions.clearAll());
    elements['my-location'].addEventListener('click', () => editor.goToUserLocation());
  }

  handleKeydown(event) {
    const editor = this.editor;
    if (editor.route.handleKeydown(event)) return;
    if (event.key === 'Escape') {
      if (editor.draw.getMode() !== 'select') {
        event.preventDefault();
        event.stopPropagation();
        this.cancelActiveDrawing();
        return;
      }
      if (editor.selected) {
        event.preventDefault();
        event.stopPropagation();
        this.cancelSelectedEditing();
      }
      return;
    }
    if (!(event.key === 'z' && (event.ctrlKey || event.metaKey))) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    event.preventDefault();
    editor.actions.undoLast();
  }

  toggleEditing() {
    const editor = this.editor;
    editor.editingEnabled = !editor.editingEnabled;
    const toggle = editor.elements['toggle-editing'];
    toggle.textContent = editor.editingEnabled ? t('disableEditing') : t('enableEditing');
    toggle.classList.toggle('primary', !editor.editingEnabled);
    [
      'draw-point',
      'draw-line',
      'draw-polygon',
      'draw-rect',
      'draw-circle',
      'select',
      'undo-edit',
    ].forEach((id) => {
      editor.elements[id].disabled = !editor.editingEnabled;
    });
    editor.elements['new-road-type'].disabled = !editor.editingEnabled;
    this.updateRoadDrawAvailability();
    if (!editor.editingEnabled) {
      editor.draw.clear();
      editor.draw.setMode('select');
      editor.featureEditor.clearSelection();
      editor.snapping.updateIndicator(undefined);
    }
    editor.setStatus(editor.editingEnabled ? t('editingEnabled') : t('editingDisabled'));
    if (editor.editingEnabled) this.prepareViewportRoads(true);
  }

  updateRoadDrawAvailability() {
    const editor = this.editor;
    editor.elements['draw-line'].disabled = (
      !editor.editingEnabled
      || !editor.elements['new-road-type'].value
    );
  }

  setInteractionState(state) {
    document.body.classList.toggle('road-drawing', state === 'drawing');
    document.body.classList.toggle('road-editing', state === 'editing');
    const indicator = this.editor.elements['edit-state'];
    indicator.hidden = !state;
    indicator.textContent = state
      ? t(state === 'drawing' ? 'roadDrawingState' : 'roadEditingState')
      : '';
  }

  cancelActiveDrawing() {
    const editor = this.editor;
    editor.draw.clear();
    editor.draw.setMode('select');
    editor.featureEditor.clearPendingDraw();
    editor.snapping.updateIndicator(undefined);
    this.setInteractionState(null);
    Object.values(DRAW_MODE_BUTTONS).forEach(
      (id) => editor.elements[id].classList.remove('active'),
    );
    editor.elements.select.classList.add('active');
    editor.setStatus(t('drawingCancelled'));
  }

  cancelSelectedEditing({ announce = true } = {}) {
    const editor = this.editor;
    if (!editor.selected) return;
    const wasRoad = editor.selected.properties?.feature_type === 'road';
    const changed = wasRoad
      && editor.featureEditor.roadEditSession.isDirty(editor.selected.serverId);
    this.roadBend?.cancel({ restore: false });
    editor.draw.clear();
    editor.featureEditor.roadEditSession.cancel();
    editor.featureEditor.clearSelection();
    if (announce) {
      editor.setStatus(t(changed ? 'roadEditCancelled' : 'editingCancelled'));
    }
  }

  async prepareViewportRoads(announce = false) {
    const editor = this.editor;
    if (!editor.editingEnabled || this.preparingRoads || editor.fullBase) return;
    if (editor.map.getZoom() < 15) {
      if (announce) editor.setStatus(t('editingZoomHint'));
      return;
    }
    if (Date.now() < this.roadPrepareCooldown) return;
    const bounds = editor.map.getBounds();
    const box = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];
    const covered = this.preparedRoadAreas.some(
      (area) => box[0] >= area[0]
        && box[1] >= area[1]
        && box[2] <= area[2]
        && box[3] <= area[3],
    );
    if (covered) return;
    this.preparingRoads = true;
    try {
      const result = await featuresApi.importOsm('roads', {
        west: box[0],
        south: box[1],
        east: box[2],
        north: box[3],
      });
      this.preparedRoadAreas.push(box);
      if (this.preparedRoadAreas.length > 20) this.preparedRoadAreas.shift();
      editor.osmImport.showImportedLayers();
      editor.refreshEditorTiles();
      await editor.refreshEditorData();
      if (result.roads_loaded > 0) editor.markRoadNetworkStale();
      editor.setStatus(t('roadsPrepared', { count: result.roads_loaded }));
    } catch (error) {
      console.error('Unable to prepare viewport roads', error);
      this.roadPrepareCooldown = Date.now() + 30_000;
      editor.setStatus(t('roadsPrepareFailed'), true);
    } finally {
      this.preparingRoads = false;
    }
  }

  setDrawMode(mode) {
    const editor = this.editor;
    if (!editor.editingEnabled) return;
    if (mode !== 'select') {
      editor.draw.clear();
      editor.featureEditor.clearSelection();
    }
    if (mode === 'linestring') {
      const roadType = editor.elements['new-road-type'].value;
      if (!roadType) {
        editor.setStatus(t('selectRoadClassFirst'), true);
        editor.elements['new-road-type'].focus();
        return;
      }
      editor.featureEditor.setPendingRoad(roadType);
      editor.featureForm.setRoadType(roadType, { applyDefault: true });
      editor.setStatus(t('roadDrawingActive'));
      this.setInteractionState('drawing');
    } else if (mode !== 'select') {
      editor.featureEditor.clearPendingDraw();
      this.setInteractionState(null);
    } else {
      this.setInteractionState(
        editor.selected?.properties?.feature_type === 'road' ? 'editing' : null,
      );
    }
    editor.draw.setMode(mode);
    editor.snapping.updateIndicator(undefined);
    Object.values(DRAW_MODE_BUTTONS).forEach(
      (id) => editor.elements[id].classList.remove('active'),
    );
    editor.elements[DRAW_MODE_BUTTONS[mode]].classList.add('active');
  }
}
