import {
  ApiError,
  featuresApi,
  isMissing,
  isStaleEdit,
} from './api.js';
import {
  BUSINESS_ICONS,
  rawFeaturePayload,
} from './feature-form.js';
import {
  circularise,
  flipLong,
  flipShort,
  geometryBounds,
  offsetGeometry,
  orthogonalize,
} from './geometry.js';
import {
  snapRoadEndpoints,
  validateRoadLineString,
} from './road-editing.js';
import { t } from './strings.js';
import { UndoStack } from './undo-stack.js';

export class FeatureActions {
  constructor(editor) {
    this.editor = editor;
    this.undoStack = new UndoStack();
  }

  pushUndo(revert, { roadMutation = false } = {}) {
    this.undoStack.push(revert, { roadMutation });
  }

  handleStaleEdit(error) {
    if (!isStaleEdit(error)) return false;
    this.editor.setStatus(t('featureChanged'), true);
    return true;
  }

  async undoLast() {
    const editor = this.editor;
    if (!editor.editingEnabled) return;
    if (editor.selected?.properties?.feature_type === 'road') {
      const geometry = editor.featureEditor.roadEditSession
        .undoDraft(editor.selected.serverId);
      if (geometry) {
        const drawFeature = editor.draw.getSnapshot().find(
          (feature) => String(feature.properties?.serverId) === editor.selected.serverId,
        );
        if (drawFeature) editor.draw.updateFeatureGeometry(drawFeature.id, geometry);
        editor.updateRoadConnectivity(editor.visibleFeatures);
        editor.setStatus(t('roadDraftUndo'));
        return;
      }
    }
    const entry = this.undoStack.take();
    if (!entry) {
      editor.setStatus(t('nothingToUndo'));
      return;
    }
    try {
      await entry.revert();
      editor.draw.clear();
      editor.featureEditor.clearSelection();
      editor.refreshEditorTiles();
      await editor.refreshEditorData();
      if (entry.roadMutation) editor.markRoadNetworkStale();
      editor.setStatus(t('undoDone'));
    } catch (error) {
      this.undoStack.restore(entry);
      console.error('Unable to undo', error);
      editor.setStatus(t('undoFailed'), true);
    }
  }

  async duplicateSelected() {
    const editor = this.editor;
    if (!editor.editingEnabled || !editor.selected) return;
    const {
      base_source,
      base_source_layer,
      base_feature_id,
      osm_id,
      osm_type,
      ...properties
    } = editor.selected.properties || {};
    const payload = rawFeaturePayload(
      offsetGeometry(editor.featureEditor.currentSelectedGeometry()),
      { ...properties, source_kind: 'manual' },
    );
    try {
      const saved = await featuresApi.create(payload);
      const isRoad = saved.feature_type === 'road';
      this.pushUndo(
        () => featuresApi.remove(saved.id, {
          confirmPublished: true,
          expectedUpdatedAt: saved.updated_at,
        }),
        { roadMutation: isRoad },
      );
      editor.featureEditor.adoptSavedFeature(saved);
      editor.featureEditor.showFeaturePanel();
      editor.featureEditor.beginGeometryEditing(String(saved.id), saved.geometry);
      editor.refreshEditorTiles();
      await editor.refreshEditorData();
      if (isRoad) editor.markRoadNetworkStale();
      editor.setStatus(t('duplicated'));
    } catch (error) {
      console.error('Unable to duplicate feature', error);
      editor.setStatus(t('duplicateFailed'), true);
    }
  }

  handleContextMenu(event) {
    const editor = this.editor;
    if (!editor.editingEnabled || !editor.selected) return;
    const reach = 6;
    const clickBox = [
      [event.point.x - reach, event.point.y - reach],
      [event.point.x + reach, event.point.y + reach],
    ];
    const rendered = editor.map.queryRenderedFeatures(
      clickBox,
      { layers: editor.interactiveLayers },
    );
    const hitSelected = rendered.some(
      (feature) => String(feature.id ?? feature.properties?.id)
        === editor.selected.serverId,
    );
    if (!hitSelected) return;
    editor.featureMenu.open(
      event.originalEvent.clientX,
      event.originalEvent.clientY,
      editor.selected.geometry?.type,
    );
  }

  handleMenuOperation(operation) {
    if (operation === 'copy') {
      this.duplicateSelected();
      return;
    }
    if (operation === 'delete') {
      this.deleteSelected();
      return;
    }
    const transform = {
      circularise,
      square: orthogonalize,
      flipLong,
      flipShort,
    }[operation];
    if (transform) this.applyGeometryTransform(transform);
  }

  async applyGeometryTransform(transform) {
    const editor = this.editor;
    if (!editor.editingEnabled || !editor.selected) return;
    const serverId = editor.selected.serverId;
    const previous = {
      geometry: editor.selected.geometry,
      properties: { ...editor.selected.properties },
    };
    let geometry = transform(editor.featureEditor.currentSelectedGeometry());
    if (!geometry) {
      editor.setStatus(t('geometryOpFailed'), true);
      return;
    }
    const isRoad = previous.properties.feature_type === 'road';
    if (isRoad) {
      geometry = snapRoadEndpoints(geometry, editor.roadSegmentIndex, serverId);
      const validation = validateRoadLineString(geometry);
      if (!validation.valid) {
        editor.setStatus(t(validation.reason), true);
        return;
      }
      editor.featureEditor.roadEditSession.stage(geometry);
      const drawFeature = editor.draw.getSnapshot().find(
        (feature) => String(feature.properties?.serverId) === serverId,
      );
      if (drawFeature) editor.draw.updateFeatureGeometry(drawFeature.id, geometry);
      editor.updateRoadConnectivity(editor.visibleFeatures);
      editor.setStatus(t('roadGeometryDraft'));
      return;
    }
    try {
      const saved = await featuresApi.update(
        serverId,
        rawFeaturePayload(geometry, previous.properties),
        { expectedUpdatedAt: previous.properties.updated_at },
      );
      this.pushUndo(
        () => featuresApi.update(
          serverId,
          rawFeaturePayload(previous.geometry, previous.properties),
          { expectedUpdatedAt: saved.updated_at },
        ),
        { roadMutation: isRoad },
      );
      editor.featureEditor.adoptSavedFeature(saved);
      editor.refreshEditorTiles();
      await editor.refreshEditorData();
      editor.featureEditor.beginGeometryEditing(serverId, saved.geometry);
      editor.setStatus(t('geometryOpApplied'));
    } catch (error) {
      if (this.handleStaleEdit(error)) return;
      if (isMissing(error)) {
        await editor.featureEditor.handleMissingFeature(t('featureMissingSave'));
        return;
      }
      console.error('Unable to apply geometry operation', error);
      editor.setStatus(t('geometryOpFailed'), true);
    }
  }

  async renderBuildingBusinesses() {
    const editor = this.editor;
    const list = editor.elements['building-businesses'];
    const selected = editor.selected;
    const isSavedBuilding = (
      selected?.properties?.feature_type === 'building'
      && selected?.serverId
    );
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = t('businessesEmpty');
    list.replaceChildren(empty);
    editor.elements['add-business'].disabled = (
      !editor.editingEnabled
      || !isSavedBuilding
    );
    if (!isSavedBuilding) return;
    try {
      const collection = await featuresApi.businesses(selected.serverId);
      if (editor.selected !== selected || !collection.features.length) return;
      list.replaceChildren(...collection.features.map((feature) => {
        const item = document.createElement('li');
        const open = document.createElement('button');
        open.type = 'button';
        const icon = feature.properties?.icon || '';
        open.textContent = `${icon} ${
          feature.properties?.name || t('businessUnnamed')
        }`.trim();
        open.addEventListener('click', () => {
          editor.map.flyTo({
            center: feature.geometry.coordinates,
            zoom: Math.max(editor.map.getZoom(), 17),
            essential: true,
          });
          editor.featureEditor.selectRenderedFeature(feature);
        });
        item.append(open);
        return item;
      }));
    } catch (error) {
      console.error('Unable to load building businesses', error);
    }
  }

  async addBusinessToBuilding() {
    const editor = this.editor;
    if (!editor.editingEnabled || !editor.selected?.serverId) return;
    const buildingId = Number(editor.selected.serverId);
    if (!Number.isInteger(buildingId)) return;
    const [[west, south], [east, north]] = geometryBounds(
      editor.selected.geometry,
    );
    try {
      const saved = await featuresApi.create({
        name: '',
        description: '',
        geometry: {
          type: 'Point',
          coordinates: [(west + east) / 2, (south + north) / 2],
        },
        properties: {},
        source_kind: 'manual',
        feature_type: 'business',
        icon: BUSINESS_ICONS.shop,
        building_id: buildingId,
      });
      this.pushUndo(() => featuresApi.remove(saved.id, {
        expectedUpdatedAt: saved.updated_at,
      }));
      editor.featureEditor.adoptSavedFeature(saved);
      editor.featureEditor.showFeaturePanel();
      editor.featureEditor.beginGeometryEditing(String(saved.id), saved.geometry);
      editor.refreshEditorTiles();
      await editor.refreshEditorData();
      editor.setStatus(t('businessAdded'));
    } catch (error) {
      console.error('Unable to add business', error);
      editor.setStatus(t('businessAddFailed'), true);
    }
  }

  async saveProperties() {
    const editor = this.editor;
    if (!editor.selected) return;
    const serverId = editor.selected.serverId;
    const roadSpan = editor.selected.roadSpan;
    const previous = {
      geometry: roadSpan
        ? editor.selected.fullGeometry
        : editor.selected.geometry,
      properties: { ...editor.selected.properties },
    };
    let geometry = editor.featureEditor.currentSelectedGeometry();
    const isRoad = editor.selected.properties?.feature_type === 'road'
      || editor.elements['feature-type'].value === 'road';
    if (isRoad) {
      geometry = snapRoadEndpoints(geometry, editor.roadSegmentIndex, serverId);
      const validation = validateRoadLineString(geometry);
      if (!validation.valid) {
        editor.setStatus(t(validation.reason), true);
        return;
      }
      editor.featureEditor.roadEditSession.stage(geometry);
    }
    try {
      const payload = editor.featureForm.buildPayload(
        geometry,
        editor.selected.properties,
      );
      let saved;
      if (isRoad && roadSpan) {
        const mutation = await featuresApi.updateRoadSegment(serverId, {
          start: roadSpan.start,
          end: roadSpan.end,
          feature: payload,
        }, {
          expectedUpdatedAt: previous.properties.updated_at,
        });
        saved = mutation.feature;
        this.pushUndo(
          () => featuresApi.restoreRoadSegment(serverId, {
            feature: rawFeaturePayload(previous.geometry, previous.properties),
            sibling_ids: mutation.sibling_ids,
          }, {
            expectedUpdatedAt: mutation.feature.updated_at,
          }),
          { roadMutation: true },
        );
      } else {
        saved = await featuresApi.update(serverId, payload, {
          expectedUpdatedAt: previous.properties.updated_at,
        });
        this.pushUndo(
          () => featuresApi.update(
            serverId,
            rawFeaturePayload(previous.geometry, previous.properties),
            { expectedUpdatedAt: saved.updated_at },
          ),
          { roadMutation: isRoad },
        );
      }
      editor.featureEditor.adoptSavedFeature(saved);
      editor.refreshEditorTiles();
      await editor.refreshEditorData();
      editor.featureEditor.showFeaturePanel();
      editor.featureEditor.beginGeometryEditing(serverId, saved.geometry);
      if (isRoad) {
        editor.markRoadNetworkStale();
        editor.setStatus(t('roadUpdated', {
          connected: editor.selectedRoadConnectedEnds(),
          total: 2,
        }));
      } else {
        editor.setStatus(t('propertiesSaved'));
      }
    } catch (error) {
      if (this.handleStaleEdit(error)) return;
      if (isMissing(error)) {
        await editor.featureEditor.handleMissingFeature(t('featureMissingSave'));
        return;
      }
      console.error('Unable to save properties', error);
      editor.setStatus(t('propertiesSaveFailed'), true);
    }
  }

  async deleteSelected() {
    const editor = this.editor;
    if (!editor.editingEnabled || !editor.selected) return;
    const properties = editor.selected.properties || {};
    const isBaseCopy = (
      properties.base_feature_id !== undefined
      && properties.base_feature_id !== null
    ) || (
      properties.source_kind === 'osm_import'
      && Boolean(properties.osm_id)
    );
    const serverId = editor.selected.serverId;
    const isRoad = properties.feature_type === 'road';
    const roadSpan = isRoad ? editor.selected.roadSpan : null;
    const snapshot = {
      geometry: roadSpan
        ? editor.selected.fullGeometry
        : editor.selected.geometry,
      properties: { ...editor.selected.properties },
    };
    const deleteButton = editor.elements['delete-feature'];
    deleteButton.disabled = true;
    try {
      const segmentMutation = await this.performDelete({
        serverId,
        roadSpan,
        isBaseCopy,
        expectedUpdatedAt: properties.updated_at,
      });
      this.pushUndo(
        roadSpan
          ? () => featuresApi.restoreRoadSegment(serverId, {
            feature: rawFeaturePayload(snapshot.geometry, snapshot.properties),
            sibling_ids: segmentMutation.sibling_ids,
          }, {
            expectedUpdatedAt: segmentMutation.feature.updated_at,
          })
          : isBaseCopy
            ? () => featuresApi.update(serverId, {
              source_kind: snapshot.properties.source_kind || 'manual',
            }, {
              expectedUpdatedAt: segmentMutation.updated_at,
            })
            : () => featuresApi.create(
              rawFeaturePayload(snapshot.geometry, snapshot.properties),
            ),
        { roadMutation: isRoad },
      );
      editor.draw.clear();
      editor.featureEditor.clearSelection();
      editor.refreshEditorTiles();
      await editor.refreshEditorData();
      if (isRoad) editor.markRoadNetworkStale();
      editor.setStatus(
        isBaseCopy && !roadSpan ? t('baseObjectRemoved') : t('featureDeleted'),
      );
    } catch (error) {
      if (error?.message === 'delete_cancelled') return;
      if (this.handleStaleEdit(error)) return;
      if (isMissing(error)) {
        await editor.featureEditor.handleMissingFeature(t('featureMissingDelete'));
        return;
      }
      console.error('Unable to delete feature', error);
      editor.setStatus(t('deleteFailed'), true);
    } finally {
      if (editor.selected) {
        deleteButton.disabled = !editor.editingEnabled;
      }
    }
  }

  async performDelete({
    serverId,
    roadSpan,
    isBaseCopy,
    expectedUpdatedAt,
  }) {
    let confirmPublished = false;
    while (true) {
      try {
        if (roadSpan) {
          return await featuresApi.deleteRoadSegment(serverId, {
            start: roadSpan.start,
            end: roadSpan.end,
          }, { confirmPublished, expectedUpdatedAt });
        }
        if (isBaseCopy) {
          return await featuresApi.update(
            serverId,
            { source_kind: 'base_tombstone' },
            { confirmPublished, expectedUpdatedAt },
          );
        } else {
          await featuresApi.remove(serverId, {
            confirmPublished,
            expectedUpdatedAt,
          });
        }
        return null;
      } catch (error) {
        const needsConfirmation = error instanceof ApiError
          && error.status === 409
          && error.message === 'published_road_confirmation_required';
        if (!needsConfirmation) throw error;
        if (!window.confirm(t('publishedRoadDeleteConfirm'))) {
          this.editor.setStatus(t('deleteCancelled'));
          throw new Error('delete_cancelled');
        }
        confirmPublished = true;
      }
    }
  }

  renderHiddenObjects(tombstones) {
    const list = this.editor.elements['hidden-objects'];
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
      label.textContent = feature.properties?.name
        || t('objectFallbackName', { id: feature.id });
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.textContent = t('restore');
      restore.addEventListener('click', () => this.restoreHiddenObject(feature));
      item.append(label, restore);
      return item;
    }));
  }

  async restoreHiddenObject(feature) {
    const editor = this.editor;
    try {
      try {
        await featuresApi.remove(feature.id, {
          confirmPublished: true,
          expectedUpdatedAt: feature.properties?.updated_at,
        });
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      this.pushUndo(
        () => featuresApi.create(
          rawFeaturePayload(feature.geometry, feature.properties),
        ),
        { roadMutation: feature.properties?.feature_type === 'road' },
      );
      editor.refreshEditorTiles();
      await editor.refreshEditorData();
      if (feature.properties?.feature_type === 'road') {
        editor.markRoadNetworkStale();
      }
      editor.setStatus(t('baseObjectRestored'));
    } catch (error) {
      console.error('Unable to restore basemap object', error);
      editor.setStatus(t('restoreFailed'), true);
    }
  }

  async clearAll() {
    const editor = this.editor;
    if (!window.confirm(t('clearAllConfirm'))) return;
    const hadRoads = editor.roadSegmentIndex.cells.size > 0
      || editor.roadSegmentIndex.longSegments.length > 0;
    try {
      await featuresApi.clearAll();
      editor.draw.clear();
      editor.featureEditor.clearSelection();
      editor.refreshEditorTiles();
      await editor.refreshEditorData();
      if (hadRoads) editor.markRoadNetworkStale();
      editor.setStatus(t('cleared'));
    } catch (error) {
      console.error('Unable to clear editor data', error);
      editor.setStatus(t('clearFailed'), true);
    }
  }
}
