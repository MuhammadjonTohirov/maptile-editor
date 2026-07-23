import { featuresApi } from './api.js';
import { applyBaseFeatureMasks } from './base-masks.js';
import { featureAnchors } from './emoji-icons.js';
import { collectVertices } from './geometry.js';

const VIEWPORT_FEATURE_LIMIT = 2000;
const EDIT_ZOOM = 15;

// Owns feature collection reads and their map-facing derived data. Each read
// gets a sequence token so a slower old viewport response cannot replace a
// newer one after a pan or tab refresh.
export class EditorData {
  constructor({ map, featureCount }) {
    this.map = map;
    this.featureCount = featureCount;
    this.sequence = 0;
  }

  async refresh({ fullBase, totalFeatureCount, baseFilters }) {
    const sequence = ++this.sequence;
    if (fullBase) {
      return this.refreshViewport(sequence, totalFeatureCount);
    }
    try {
      const collection = await featuresApi.list();
      if (!this.isCurrent(sequence)) return null;
      const visible = this.visibleFeatures(collection.features);
      this.featureCount.textContent = visible.length;
      applyBaseFeatureMasks(this.map, baseFilters, collection.features);
      this.map.getSource('editor_anchors')?.setData(featureAnchors(collection.features));
      return {
        visible,
        snapVertices: collectVertices(visible),
        tombstones: collection.features.filter(
          (feature) => feature.properties?.source_kind === 'base_tombstone',
        ),
      };
    } catch (error) {
      if (!this.isCurrent(sequence)) return null;
      console.error('Unable to load editor data', error);
      this.featureCount.textContent = '—';
      return null;
    }
  }

  async refreshViewport(sequence, totalFeatureCount) {
    if (!this.isCurrent(sequence)) return null;
    if (totalFeatureCount != null) {
      this.featureCount.textContent = totalFeatureCount;
    }
    if (this.map.getZoom() < EDIT_ZOOM) {
      return { visible: [], snapVertices: [], tombstones: null };
    }
    try {
      const bounds = this.map.getBounds();
      const bbox = [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ].join(',');
      const collection = await featuresApi.listInBounds(bbox, VIEWPORT_FEATURE_LIMIT);
      if (!this.isCurrent(sequence)) return null;
      const visible = this.visibleFeatures(collection.features);
      return {
        visible,
        snapVertices: collectVertices(visible),
        tombstones: null,
      };
    } catch (error) {
      if (!this.isCurrent(sequence)) return null;
      console.error('Unable to load viewport features', error);
      return { visible: [], snapVertices: [], tombstones: null };
    }
  }

  visibleFeatures(features) {
    return features.filter(
      (feature) => feature.properties?.source_kind !== 'base_tombstone',
    );
  }

  isCurrent(sequence) {
    return sequence === this.sequence;
  }
}
