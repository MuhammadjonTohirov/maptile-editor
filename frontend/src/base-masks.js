// Style layers that render each basemap source layer. A local copy of a base
// feature (or its tombstone) masks the original out of all of them through its
// base_feature_id, so the copy replaces the original visually.
export const BASE_MASK_LAYERS = {
  building: ['buildings', 'base-buildings-3d'],
  transportation: ['transportation', 'transportation-casing'],
  waterway: ['waterway'],
  poi: ['poi'],
};

export function captureBaseFilters(map) {
  return new Map(
    Object.values(BASE_MASK_LAYERS).flat().map((layerId) => [layerId, map.getFilter(layerId) ?? null]),
  );
}

// OpenMapTiles keeps the OSM id as the tile feature id for these layers, so
// imported OSM features can mask their basemap originals through osm_id.
// Roads are omitted: the transportation layer merges ways, so ids rarely
// match and the id list would only slow the filter down.
const SOURCE_LAYER_BY_FEATURE_TYPE = {
  building: 'building',
  waterway: 'waterway',
  poi: 'poi',
};

export function applyBaseFeatureMasks(map, baseFilters, features) {
  const maskedIds = new Map(Object.keys(BASE_MASK_LAYERS).map((sourceLayer) => [sourceLayer, []]));
  const addMask = (sourceLayer, id) => {
    if (id === undefined || id === null || id === '') return;
    const ids = maskedIds.get(sourceLayer);
    if (!ids) return;
    const numeric = Number(id);
    ids.push(Number.isFinite(numeric) ? numeric : id);
  };
  for (const feature of features) {
    const properties = feature.properties || {};
    addMask(properties.base_source_layer, properties.base_feature_id);
    if (properties.osm_id && ['osm_import', 'base_tombstone'].includes(properties.source_kind)) {
      addMask(SOURCE_LAYER_BY_FEATURE_TYPE[properties.feature_type], properties.osm_id);
    }
  }
  for (const [sourceLayer, layerIds] of Object.entries(BASE_MASK_LAYERS)) {
    const ids = maskedIds.get(sourceLayer);
    const mask = ids.length ? ['!', ['in', ['id'], ['literal', ids]]] : null;
    for (const layerId of layerIds) {
      const baseFilter = baseFilters.get(layerId);
      map.setFilter(layerId, baseFilter && mask ? ['all', baseFilter, mask] : (mask || baseFilter));
    }
  }
}
