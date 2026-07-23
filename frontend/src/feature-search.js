import { featuresApi } from './api.js';
import { geometryBounds } from './geometry.js';
import { t } from './strings.js';

export class FeatureSearchUI {
  constructor({ map, input, options, onStatus }) {
    this.map = map;
    this.input = input;
    this.options = options;
    this.onStatus = onStatus;
    this.timer = null;
    this.requestSequence = 0;
  }

  bind() {
    this.input.addEventListener('change', () => this.jumpToFeature(this.input.value));
    this.input.addEventListener('input', () => {
      clearTimeout(this.timer);
      const query = this.input.value.trim();
      const sequence = ++this.requestSequence;
      if (query.length < 2) {
        this.options.replaceChildren();
        return;
      }
      this.timer = setTimeout(() => this.populateOptions(query, sequence), 250);
    });
  }

  async jumpToFeature(query) {
    const needle = query.trim();
    if (!needle) return;
    let feature;
    try {
      feature = (await featuresApi.search(needle, 1)).features[0];
    } catch (error) {
      console.error('Unable to search features', error);
      this.onStatus(t('searchMiss', { query: needle }), true);
      return;
    }
    if (!feature) {
      this.onStatus(t('searchMiss', { query: needle }), true);
      return;
    }
    if (feature.geometry.type === 'Point') {
      this.map.flyTo({ center: feature.geometry.coordinates, zoom: 17, essential: true });
    } else {
      this.map.fitBounds(
        geometryBounds(feature.geometry),
        { padding: 80, maxZoom: 18, essential: true },
      );
    }
    this.onStatus(t('searchHit', { name: feature.properties?.name || needle }));
  }

  async populateOptions(query, sequence = ++this.requestSequence) {
    try {
      const collection = await featuresApi.search(query, 8);
      if (sequence !== this.requestSequence) return;
      const names = [
        ...new Set(collection.features
          .map((feature) => feature.properties?.name)
          .filter(Boolean)),
      ];
      this.options.replaceChildren(...names.map((name) => new Option(name)));
    } catch {
      // Type-ahead is best-effort; a failed lookup just shows no suggestions.
      if (sequence === this.requestSequence) this.options.replaceChildren();
    }
  }
}
