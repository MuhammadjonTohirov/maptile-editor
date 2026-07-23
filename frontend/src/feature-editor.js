import { featuresApi, isMissing, isStaleEdit } from './api.js';
import {
  extraProperties,
  mergeFeatureProperties,
  rawFeaturePayload,
} from './feature-form.js';
import {
  drawingModeForGeometry,
  normalizeGeometry,
} from './geometry.js';
import {
  resolveSelectedGeometry,
  RoadEditSession,
  snapRoadEndpoints,
  validateRoadLineString,
} from './road-editing.js';
import { selectedRoadSpanSelection } from './road-guidance.js';
import { t } from './strings.js';

export class FeatureEditor {
  constructor(editor) {
    this.editor = editor;
    this.pendingBaseCopies = new Set();
    this.pendingDrawFeatureType = null;
    this.pendingRoadType = null;
    this.roadEditSession = new RoadEditSession();
  }

  setPendingRoad(roadType) {
    this.pendingDrawFeatureType = 'road';
    this.pendingRoadType = roadType;
  }

  clearPendingDraw() {
    this.pendingDrawFeatureType = null;
    this.pendingRoadType = null;
  }

  // Normalize the id once so all selection identity checks compare strings.
  adoptSavedFeature(
    saved,
    roadSelectionCoordinate = this.editor.selected?.roadSelectionCoordinate,
  ) {
    this.editor.selected = {
      serverId: String(saved.id),
      geometry: saved.geometry,
      properties: mergeFeatureProperties(saved),
      roadSelectionCoordinate: saved.feature_type === 'road'
        ? roadSelectionCoordinate
        : null,
    };
  }

  async persistFinishedDraw(drawId) {
    const editor = this.editor;
    const feature = editor.draw.getSnapshotFeature(drawId);
    if (!feature || !editor.editingEnabled || !feature.geometry) return;
    const serverId = feature.properties?.serverId;
    const editingSelected = serverId
      && editor.selected
      && editor.selected.serverId === String(serverId);
    const storedProperties = editingSelected
      ? editor.selected.properties
      : (feature.properties || {});
    const isRoad = (
      editingSelected
      && storedProperties.feature_type === 'road'
    ) || (!serverId && this.pendingDrawFeatureType === 'road');
    let geometry = feature.geometry;

    if (isRoad) {
      geometry = snapRoadEndpoints(
        geometry,
        editor.roadSegmentIndex,
        editingSelected ? serverId : null,
      );
      const validation = validateRoadLineString(geometry);
      if (!validation.valid) {
        const fallback = editingSelected && this.roadEditSession.geometry(serverId);
        if (fallback) editor.draw.updateFeatureGeometry(drawId, fallback);
        else if (editor.draw.hasFeature(drawId)) editor.draw.removeFeatures([drawId]);
        editor.setStatus(t(validation.reason), true);
        return;
      }
      if (editingSelected) {
        if (JSON.stringify(geometry) !== JSON.stringify(feature.geometry)) {
          editor.draw.updateFeatureGeometry(drawId, geometry);
        }
        this.roadEditSession.stage(geometry);
        editor.updateRoadConnectivity(editor.visibleFeatures);
        editor.interactions.setInteractionState('editing');
        editor.setStatus(t('roadGeometryDraft'));
        return;
      }
      if (!this.roadEditSession.claimNewDraw(drawId)) return;
    }

    const payload = editor.featureForm.buildPayload(geometry, storedProperties, {
      pendingDrawFeatureType: this.pendingDrawFeatureType,
      pendingRoadType: this.pendingRoadType,
    });
    const previous = editingSelected
      ? {
        geometry: editor.selected.geometry,
        properties: { ...editor.selected.properties },
      }
      : null;
    try {
      const saved = serverId
        ? await featuresApi.update(serverId, payload, {
          expectedUpdatedAt: editor.selected.properties?.updated_at,
        })
        : await featuresApi.create(payload);
      if (!serverId) {
        editor.actions.pushUndo(
          () => featuresApi.remove(saved.id, {
            confirmPublished: true,
            expectedUpdatedAt: saved.updated_at,
          }),
          { roadMutation: saved.feature_type === 'road' },
        );
      } else if (previous) {
        editor.actions.pushUndo(
          () => featuresApi.update(
            serverId,
            rawFeaturePayload(previous.geometry, previous.properties),
            { expectedUpdatedAt: saved.updated_at },
          ),
          {
            roadMutation: saved.feature_type === 'road'
              || previous.properties.feature_type === 'road',
          },
        );
      }
      editor.draw.removeFeatures([drawId]);
      this.adoptSavedFeature(saved);
      editor.refreshEditorTiles();
      await editor.refreshEditorData();
      this.showFeaturePanel();
      this.beginGeometryEditing(String(saved.id), saved.geometry);
      const savedIsRoad = saved.feature_type === 'road';
      if (savedIsRoad) editor.markRoadNetworkStale();
      editor.setStatus(savedIsRoad
        ? t('roadCreated', {
          connected: editor.selectedRoadConnectedEnds(),
          total: 2,
        })
        : t('featureCreated'));
      this.clearPendingDraw();
    } catch (error) {
      if (isRoad && !serverId) this.roadEditSession.releaseNewDraw(drawId);
      if (isStaleEdit(error)) {
        editor.setStatus(t('featureChanged'), true);
        return;
      }
      if (serverId && isMissing(error)) {
        await this.handleMissingFeature(t('featureMissingSave'));
        return;
      }
      console.error('Unable to save drawing', error);
      editor.setStatus(t('featureSaveFailed'), true);
    }
  }

  async selectRenderedFeature(feature, selectionCoordinate = null) {
    const editor = this.editor;
    const featureId = feature.id ?? feature.properties?.id;
    if (featureId === undefined || featureId === null) return;
    const serverId = String(featureId);
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
    const properties = { ...source.properties };
    const spanSelection = properties.feature_type === 'road' && selectionCoordinate
      ? selectedRoadSpanSelection({
        id: serverId,
        geometry: source.geometry,
        properties,
      }, editor.roadSegmentIndex, selectionCoordinate)
      : null;
    const roadSpan = spanSelection?.partial
      ? { start: spanSelection.start, end: spanSelection.end }
      : null;
    const selectedGeometry = roadSpan ? spanSelection.geometry : source.geometry;
    editor.selected = {
      serverId,
      geometry: selectedGeometry,
      fullGeometry: roadSpan ? source.geometry : null,
      roadSpan,
      properties,
      roadSelectionCoordinate: properties.feature_type === 'road'
        ? selectionCoordinate
        : null,
    };
    this.showFeaturePanel();
    editor.elements['delete-feature'].disabled = !editor.editingEnabled;
    this.beginGeometryEditing(serverId, selectedGeometry);
  }

  async handleMissingFeature(message) {
    const editor = this.editor;
    editor.draw.clear();
    this.clearSelection();
    editor.refreshEditorTiles();
    await editor.refreshEditorData();
    editor.setStatus(message);
  }

  isEditingFeature(featureId) {
    const editor = this.editor;
    if (featureId === undefined || featureId === null) return false;
    const serverId = String(featureId);
    return editor.selected?.serverId === serverId
      && editor.draw.getSnapshot().some(
        (feature) => String(feature.properties?.serverId) === serverId,
      );
  }

  beginGeometryEditing(serverId, geometry) {
    const editor = this.editor;
    if (!editor.editingEnabled) return;
    const normalized = normalizeGeometry(geometry);
    if (!normalized) {
      editor.setStatus(t('geometryNotReshapable'), true);
      return;
    }
    editor.interactions.roadBend?.cancel({ restore: false });
    editor.draw.clear();
    const drawId = editor.draw.getFeatureId();
    const validation = editor.draw.addFeatures([{
      type: 'Feature',
      id: drawId,
      geometry: normalized,
      properties: {
        serverId,
        mode: drawingModeForGeometry(normalized),
      },
    }]);
    if (validation.some((result) => !result.valid)) {
      editor.setStatus(t('geometryNotEditable'), true);
      return;
    }
    editor.draw.selectFeature(drawId);
    editor.draw.setMode('select');
    if (editor.selected?.properties?.feature_type === 'road') {
      this.roadEditSession.begin(serverId, normalized);
      editor.interactions.setInteractionState('editing');
      editor.updateRoadGuidance();
    } else {
      this.roadEditSession.clear();
      editor.interactions.setInteractionState(null);
      editor.roadGuidance.clear();
    }
    editor.snapping.updateIndicator(undefined);
  }

  async copyBaseFeatureToEditor(feature) {
    const editor = this.editor;
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
        editor.setStatus(t('baseCopySelected'));
        return;
      }
      const geometry = normalizeGeometry(feature.geometry);
      if (!geometry) {
        editor.setStatus(t('baseCopyGeometryFailed'), true);
        return;
      }
      const featureType = this.baseFeatureType(sourceLayer);
      const sourceProperties = Object.fromEntries(
        Object.entries(feature.properties || {}).filter(([, value]) =>
          value === null
          || ['string', 'number', 'boolean'].includes(typeof value)),
      );
      const name = sourceProperties['name:latin']
        || sourceProperties.name
        || editor.featureForm.typeLabel(featureType);
      const payload = {
        name,
        description: t('baseCopyDescription', { layer: sourceLayer }),
        geometry,
        properties: {
          ...extraProperties(sourceProperties),
          base_source: 'osm_base',
          base_source_layer: sourceLayer,
          base_feature_id: feature.id ?? null,
        },
        building_type: featureType === 'building'
          ? (sourceProperties.class || null)
          : null,
        source_kind: 'manual',
        feature_type: featureType,
        road_type: featureType === 'road'
          ? (sourceProperties.class || null)
          : null,
      };
      const saved = await featuresApi.create(payload);
      editor.actions.pushUndo(
        () => featuresApi.remove(saved.id, {
          confirmPublished: true,
          expectedUpdatedAt: saved.updated_at,
        }),
        { roadMutation: featureType === 'road' },
      );
      this.adoptSavedFeature(saved);
      this.showFeaturePanel();
      this.beginGeometryEditing(String(saved.id), saved.geometry);
      editor.refreshEditorTiles();
      await editor.refreshEditorData();
      editor.setStatus(t('baseCopyCreated'));
    } catch (error) {
      console.error('Unable to create editable basemap copy', error);
      editor.setStatus(t('baseCopyFailed'), true);
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
        && String(candidate.properties?.base_feature_id) === String(featureId)
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

  showFeaturePanel() {
    const editor = this.editor;
    if (!editor.selected) return;
    editor.featureForm.show(editor.selected, {
      editingEnabled: editor.editingEnabled,
      userName: (userId) => editor.auth?.userName(userId),
    });
    editor.actions.renderBuildingBusinesses();
    editor.updateSelectedRoadConnectivityHint();
  }

  clearSelection() {
    const editor = this.editor;
    editor.interactions?.roadBend?.cancel({ restore: false });
    editor.selected = null;
    this.roadEditSession.clear();
    this.clearPendingDraw();
    editor.featureForm.reset();
    editor.elements['feature-panel'].hidden = true;
    editor.elements['delete-feature'].disabled = true;
    editor.elements['duplicate-feature'].disabled = true;
    editor.snapping.updateIndicator(undefined);
    editor.roadGuidance.clear();
    editor.interactions?.setInteractionState(null);
  }

  currentSelectedGeometry() {
    const editor = this.editor;
    if (!editor.selected) return null;
    return resolveSelectedGeometry(
      editor.draw?.getSnapshot() || [],
      editor.selected.serverId,
      this.roadEditSession.geometry(editor.selected.serverId),
      editor.selected.geometry,
    );
  }
}
