import {
  roadConnectivity,
  RoadSegmentIndex,
} from './geometry.js';

export function buildRoadConnectivityState(
  features,
  selected,
  selectedGeometry,
) {
  const roads = features
    .filter((feature) => feature.properties?.feature_type === 'road')
    .map((feature) => ({ ...feature }));
  let selectedSpanRoad = null;

  if (selected?.properties?.feature_type === 'road') {
    const selectedRoad = {
      id: selected.serverId,
      // Keep the untouched remainder in the snapping index until a partial
      // span is persisted. Only the markers use the visible span below.
      geometry: selected.roadSpan ? selected.fullGeometry : selectedGeometry,
      properties: selected.properties,
    };
    if (selected.roadSpan) {
      selectedSpanRoad = { ...selectedRoad, geometry: selectedGeometry };
    }
    const existingIndex = roads.findIndex(
      (feature) => String(feature.id) === selected.serverId,
    );
    if (existingIndex === -1) roads.push(selectedRoad);
    else roads[existingIndex] = selectedRoad;
  }

  const segmentIndex = RoadSegmentIndex.fromFeatures(roads);
  const connectivityRoads = selectedSpanRoad
    ? [
      ...roads.filter((feature) => String(feature.id) !== selected.serverId),
      selectedSpanRoad,
    ]
    : roads;
  return {
    segmentIndex,
    markers: roadConnectivity(connectivityRoads, segmentIndex),
  };
}

export class RoadConnectivityUI {
  constructor(map) {
    this.map = map;
    this.segmentIndex = new RoadSegmentIndex();
    this.markers = [];
  }

  update(features, selected, selectedGeometry) {
    const state = buildRoadConnectivityState(features, selected, selectedGeometry);
    this.segmentIndex = state.segmentIndex;
    this.markers = state.markers;
    this.map.getSource('road_connectivity')?.setData({
      type: 'FeatureCollection',
      features: this.markers,
    });
    return state;
  }

  connectedEnds(serverId) {
    return this.markers.filter(
      (marker) => marker.properties.road_id === String(serverId)
        && marker.properties.connected,
    ).length;
  }
}
