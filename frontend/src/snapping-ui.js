import {
  canSnapRoadCoordinate,
  ROAD_SNAP_DEGREES,
} from './road-editing.js';

export class SnappingUI {
  constructor({
    map,
    getDrawMode,
    getSelected,
    getRoadSegmentIndex,
    getVertices,
  }) {
    this.map = map;
    this.getDrawMode = getDrawMode;
    this.getSelected = getSelected;
    this.getRoadSegmentIndex = getRoadSegmentIndex;
    this.getVertices = getVertices;
    this.indicatorKey = null;
  }

  target(event, context) {
    const best = this.nearestCoordinate(event.lng, event.lat, context);
    this.updateIndicator(best);
    return best;
  }

  nearestVertex(lng, lat) {
    // Keep the snap radius roughly constant on screen as map zoom changes.
    const threshold = (360 / (2 ** this.map.getZoom() * 512)) * 14;
    let best;
    let bestDistance = threshold * threshold;
    for (const [vertexLng, vertexLat] of this.getVertices()) {
      const deltaLng = (vertexLng - lng) * Math.cos((lat * Math.PI) / 180);
      const deltaLat = vertexLat - lat;
      const distance = deltaLng * deltaLng + deltaLat * deltaLat;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = [vertexLng, vertexLat];
      }
    }
    return best;
  }

  nearestCoordinate(lng, lat, context) {
    const drawMode = this.getDrawMode();
    const selected = this.getSelected();
    const selectedRoad = selected?.properties?.feature_type === 'road';
    const roadEditing = drawMode === 'linestring' || selectedRoad;
    if (!roadEditing) return this.nearestVertex(lng, lat);
    const editingExistingRoad = drawMode === 'select' && selectedRoad;
    if (!canSnapRoadCoordinate(context, editingExistingRoad)) return undefined;
    return this.getRoadSegmentIndex().nearestCoordinate(
      lng,
      lat,
      ROAD_SNAP_DEGREES,
      editingExistingRoad ? selected.serverId : null,
    );
  }

  previewWhileDrawing(event, editingEnabled) {
    if (!editingEnabled || this.getDrawMode() === 'select') return;
    this.updateIndicator(
      this.nearestCoordinate(event.lngLat.lng, event.lngLat.lat),
    );
  }

  updateIndicator(coordinate) {
    const key = coordinate ? coordinate.join(',') : null;
    if (key === this.indicatorKey) return;
    this.indicatorKey = key;
    this.map.getSource('snap_indicator')?.setData({
      type: 'FeatureCollection',
      features: coordinate
        ? [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: coordinate },
          properties: {},
        }]
        : [],
    });
  }
}
