// Waze-style direction and junction guidance for the road currently being
// edited. Geometry stays pure and testable; this small presenter owns only the
// dedicated GeoJSON source (architecture F1).
import { closestPointOnSegment } from './geometry.js';

const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] };
// Turn guidance represents established topology, not every road that happens
// to fall inside the wider eight-metre editing snap radius. Half a metre is
// the same precision tolerance used by the connectivity overlay.
const ROAD_JOIN_DEGREES = 0.5 / 111_320;
function arrowImage(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 72;
  canvas.height = 72;
  const context = canvas.getContext('2d');
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const draw = (strokeStyle, lineWidth) => {
    context.beginPath();
    context.moveTo(36, 68);
    context.lineTo(36, 9);
    context.moveTo(14, 31);
    context.lineTo(36, 9);
    context.lineTo(58, 31);
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    context.stroke();
  };
  draw('#ffffff', 17);
  draw(color, 9);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

// MapLibre rotates line-placed icons from their horizontal axis, so this
// sprite points right before placement. Point-placed junction arrows above
// deliberately point north because their icon-rotate value is a bearing.
function lineArrowImage(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  const context = canvas.getContext('2d');
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const draw = (strokeStyle, lineWidth) => {
    context.beginPath();
    context.moveTo(6, 24);
    context.lineTo(38, 24);
    context.moveTo(25, 11);
    context.lineTo(38, 24);
    context.lineTo(25, 37);
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    context.stroke();
  };
  draw('#ffffff', 9);
  draw(color, 5);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

// U-turn availability is not yet represented in the routing data. Render the
// control in red (as a restriction), keeping it visually distinct from real
// green outgoing-road choices instead of implying that the turn is routable.
function uturnImage() {
  const canvas = document.createElement('canvas');
  canvas.width = 72;
  canvas.height = 72;
  const context = canvas.getContext('2d');
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const draw = (strokeStyle, lineWidth) => {
    context.beginPath();
    context.moveTo(52, 68);
    context.lineTo(52, 31);
    context.quadraticCurveTo(52, 10, 34, 10);
    context.quadraticCurveTo(16, 10, 16, 31);
    context.lineTo(16, 48);
    context.moveTo(3, 35);
    context.lineTo(16, 48);
    context.lineTo(29, 35);
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    context.stroke();
  };
  draw('#ffffff', 17);
  draw('#ef4444', 9);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function installGuidanceImages(map) {
  if (!map.hasImage('road-direction-arrow')) {
    map.addImage('road-direction-arrow', lineArrowImage('#0f766e'), { pixelRatio: 2 });
  }
  if (!map.hasImage('road-turn-arrow')) {
    map.addImage('road-turn-arrow', arrowImage('#43a047'), { pixelRatio: 2 });
  }
  if (!map.hasImage('road-uturn-arrow')) {
    map.addImage('road-uturn-arrow', uturnImage(), { pixelRatio: 2 });
  }
}

function bearingDegrees(start, end) {
  const scale = Math.cos((((start[1] + end[1]) / 2) * Math.PI) / 180);
  const east = (end[0] - start[0]) * scale;
  const north = end[1] - start[1];
  return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
}

function turnManeuver(incoming, outgoing) {
  const delta = (outgoing - incoming + 540) % 360 - 180;
  const magnitude = Math.abs(delta);
  // "uturn" is reserved for the separate red restriction control below.
  // A real connected road that bends back sharply remains a green road choice.
  if (magnitude >= 150) return delta > 0 ? 'right' : 'left';
  if (magnitude < 25) return 'straight';
  if (magnitude < 60) return delta > 0 ? 'slight_right' : 'slight_left';
  return delta > 0 ? 'right' : 'left';
}

function bearingDifference(a, b) {
  return Math.abs((a - b + 540) % 360 - 180);
}

function positionsDiffer(a, b) {
  return Math.abs(a[0] - b[0]) > 1e-12 || Math.abs(a[1] - b[1]) > 1e-12;
}

function positionDistanceSquared(a, b) {
  return closestPointOnSegment(a, b, b).distanceSquared;
}

function positionsNear(a, b, threshold) {
  return positionDistanceSquared(a, b) <= threshold * threshold;
}

function closestLinePosition(coordinates, point) {
  let best = { position: 0, coordinate: coordinates[0], distanceSquared: Infinity };
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const closest = closestPointOnSegment(point, coordinates[index], coordinates[index + 1]);
    if (closest.distanceSquared >= best.distanceSquared) continue;
    best = {
      position: index + closest.fraction,
      coordinate: closest.coordinate,
      distanceSquared: closest.distanceSquared,
    };
  }
  return best;
}

function topologyCuts(road, segmentIndex, threshold) {
  const coordinates = road.geometry.coordinates;
  const owner = String(road.id);
  const cuts = [
    { position: 0, coordinate: coordinates[0], projected: false },
    { position: coordinates.length - 1, coordinate: coordinates.at(-1), projected: false },
  ];

  // Shared stored vertices are real OSM topology. Shape points with no other
  // owner at the same coordinate remain part of one selectable road span.
  for (let index = 1; index < coordinates.length - 1; index += 1) {
    const coordinate = coordinates[index];
    const connected = [...segmentIndex.candidates(coordinate[0], coordinate[1], threshold)]
      .some((segment) => segment.owner !== owner
        && (positionsNear(coordinate, segment.a, threshold)
          || positionsNear(coordinate, segment.b, threshold)));
    if (connected) cuts.push({ position: index, coordinate, projected: false });
  }

  // A manual road endpoint may attach to the middle of this host road. The
  // graph builder splits only that host segment, so mirror that local rule
  // here and avoid any viewport-wide pairwise geometry work.
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const a = coordinates[index];
    const b = coordinates[index + 1];
    const candidates = segmentIndex.candidatesForBounds(
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
      threshold,
    );
    for (const segment of candidates) {
      if (segment.owner === owner || segment.sourceKind !== 'manual') continue;
      const endpoints = [];
      if (segment.aIsEndpoint) endpoints.push(segment.a);
      if (segment.bIsEndpoint) endpoints.push(segment.b);
      for (const endpoint of endpoints) {
        const closest = closestPointOnSegment(endpoint, a, b);
        if (closest.distanceSquared > threshold * threshold
          || closest.fraction <= 1e-9 || closest.fraction >= 1 - 1e-9) continue;
        // A projected endpoint within the established topology tolerance of a
        // stored vertex is the same node. Keeping both creates centimetre (or
        // smaller) selectable spans, which in turn materialize sliver roads
        // when the span is saved or deleted. Preserve the authoritative
        // stored coordinate at both road ends and at real internal vertices.
        if (positionsNear(closest.coordinate, a, threshold)
          || positionsNear(closest.coordinate, b, threshold)) continue;
        cuts.push({
          position: index + closest.fraction,
          coordinate: closest.coordinate,
          projected: true,
        });
      }
    }
  }

  cuts.sort((left, right) => left.position - right.position);
  return cuts.filter((cut, index) => {
    if (index === 0) return true;
    const previous = cuts[index - 1];
    if (Math.abs(cut.position - previous.position) <= 1e-8) return false;
    // Several manual endpoints can project to effectively the same interior
    // host point. They represent one topology cut, not multiple micro-spans.
    return !cut.projected || !previous.projected
      || !positionsNear(cut.coordinate, previous.coordinate, threshold);
  });
}

// A stored OSM way can cross many junctions. Waze-style editing presents only
// the span surrounding the click, bounded by its two adjacent topology nodes.
export function selectedRoadSpanSelection(
  road,
  segmentIndex,
  selectionCoordinate,
  threshold = ROAD_JOIN_DEGREES,
) {
  const coordinates = road?.geometry?.coordinates;
  if (road?.geometry?.type !== 'LineString' || !Array.isArray(coordinates) || coordinates.length < 2) {
    return null;
  }
  if (!Array.isArray(selectionCoordinate)) {
    return {
      geometry: structuredClone(road.geometry),
      start: [...coordinates[0]],
      end: [...coordinates.at(-1)],
      partial: false,
    };
  }
  const selection = closestLinePosition(coordinates, selectionCoordinate);
  const cuts = topologyCuts(road, segmentIndex, threshold);
  let lowerIndex = 0;
  while (lowerIndex + 1 < cuts.length
    && cuts[lowerIndex + 1].position <= selection.position + 1e-9) lowerIndex += 1;
  let upperIndex = Math.min(lowerIndex + 1, cuts.length - 1);
  if (Math.abs(cuts[lowerIndex].position - selection.position) <= 1e-9 && lowerIndex > 0) {
    // A click exactly on a junction is ambiguous. Prefer the span whose final
    // segment leads into that node, matching normal map hit-testing order.
    upperIndex = lowerIndex;
    lowerIndex -= 1;
  }
  const lower = cuts[lowerIndex];
  const upper = cuts[upperIndex];
  const span = [[...lower.coordinate]];
  for (let index = 1; index < coordinates.length - 1; index += 1) {
    if (index > lower.position + 1e-9 && index < upper.position - 1e-9) {
      span.push([...coordinates[index]]);
    }
  }
  if (!positionsNear(span.at(-1), upper.coordinate, 1e-12)) span.push([...upper.coordinate]);
  return {
    geometry: { type: 'LineString', coordinates: span },
    start: [...lower.coordinate],
    end: [...upper.coordinate],
    partial: lower.position > 1e-9 || upper.position < coordinates.length - 1 - 1e-9,
  };
}

export function selectedRoadSpan(road, segmentIndex, selectionCoordinate, threshold = ROAD_JOIN_DEGREES) {
  return selectedRoadSpanSelection(road, segmentIndex, selectionCoordinate, threshold)?.geometry || null;
}

export function sameRoadSpan(left, right, threshold = 1e-12) {
  return Boolean(left && right
    && positionsNear(left.start, right.start, threshold)
    && positionsNear(left.end, right.end, threshold));
}

function connectedSegments(exit, road, segmentIndex, threshold) {
  const vertexConnections = [];
  const interiorConnections = [];
  const thresholdSquared = threshold * threshold;
  for (const segment of segmentIndex.candidates(exit.endpoint[0], exit.endpoint[1], threshold)) {
    const closest = closestPointOnSegment(exit.endpoint, segment.a, segment.b);
    if (closest.distanceSquared > thresholdSquared) continue;
    const touchesStoredVertex = positionDistanceSquared(exit.endpoint, segment.a) <= thresholdSquared
      || positionDistanceSquared(exit.endpoint, segment.b) <= thresholdSquared;
    (touchesStoredVertex ? vertexConnections : interiorConnections).push({ segment, closest });
  }

  // Equal stored vertices are explicit topology and may legitimately fan out
  // to several roads. A mid-segment endpoint snap, however, splits only one
  // host road, so retain only its single nearest segment.
  interiorConnections.sort((a, b) => a.closest.distanceSquared - b.closest.distanceSquared);
  return vertexConnections.concat(interiorConnections.slice(0, 1));
}

function outgoingTargets(segment) {
  if (segment.direction === 'oneway') return [segment.b];
  if (segment.direction === 'oneway_reverse') return [segment.a];
  return [segment.a, segment.b];
}

function travelEnds(coordinates, direction) {
  const start = {
    endpoint: coordinates[0],
    previous: coordinates[1],
    index: 0,
  };
  const end = {
    endpoint: coordinates.at(-1),
    previous: coordinates.at(-2),
    index: 1,
  };
  if (direction === 'oneway') return [end];
  if (direction === 'oneway_reverse') return [start];
  return [start, end];
}

function turnFeatures(exit, road, segmentIndex, threshold) {
  const features = [];
  const seenBearings = [];
  const incoming = bearingDegrees(exit.previous, exit.endpoint);
  for (const { segment, closest } of connectedSegments(exit, road, segmentIndex, threshold)) {
    for (const target of outgoingTargets(segment)) {
      if (!positionsDiffer(closest.coordinate, target)) continue;
      // The segment immediately behind the selected span is where travel
      // arrived from, not a turn option. Same-feature segments pointing away
      // from an internal junction remain visible as straight continuations.
      if (positionsNear(exit.previous, target, threshold)) continue;
      const bearing = bearingDegrees(closest.coordinate, target);
      // Imported OSM data can contain overlapping way fragments or paired
      // carriageways leaving the same junction. Editors need one control per
      // turn direction, not one stacked control per backing feature.
      if (seenBearings.some((seen) => bearingDifference(seen, bearing) < 12)) continue;
      seenBearings.push(bearing);
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: exit.endpoint },
        properties: {
          kind: 'turn-arrow',
          road_id: segment.owner,
          maneuver: turnManeuver(incoming, bearing),
          bearing,
        },
      });
    }
  }

  if ((road.properties?.direction || 'bidirectional') === 'bidirectional') {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: exit.endpoint },
      properties: {
        kind: 'turn-arrow',
        maneuver: 'uturn',
        bearing: incoming,
        allowed: false,
      },
    });
  }

  return features;
}

export function roadGuidanceCollection(
  road,
  segmentIndex,
  selectionCoordinate = null,
  threshold = ROAD_JOIN_DEGREES,
) {
  const coordinates = road?.geometry?.coordinates;
  if (road?.geometry?.type !== 'LineString' || !Array.isArray(coordinates) || coordinates.length < 2) {
    return structuredClone(EMPTY_COLLECTION);
  }
  const direction = road.properties?.direction || 'bidirectional';
  const guidanceGeometry = selectedRoadSpan(road, segmentIndex, selectionCoordinate, threshold);
  const guidanceRoad = { ...road, geometry: guidanceGeometry };
  const guidanceCoordinates = guidanceGeometry.coordinates;
  const features = [{
    type: 'Feature',
    geometry: guidanceGeometry,
    properties: { kind: 'selected' },
  }];

  if (direction === 'oneway' || direction === 'oneway_reverse') {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: direction === 'oneway_reverse'
          ? [...guidanceCoordinates].reverse()
          : guidanceCoordinates,
      },
      properties: { kind: 'direction' },
    });
  }

  for (const exit of travelEnds(guidanceCoordinates, direction)) {
    features.push(...turnFeatures(exit, guidanceRoad, segmentIndex, threshold));
  }
  return { type: 'FeatureCollection', features };
}

export class RoadGuidanceUI {
  constructor(map) {
    this.map = map;
    if (map.loaded()) installGuidanceImages(map);
    else map.once('load', () => installGuidanceImages(map));
  }

  update(road, segmentIndex, selectionCoordinate) {
    this.map.getSource('road_guidance')?.setData(
      roadGuidanceCollection(road, segmentIndex, selectionCoordinate),
    );
  }

  clear() {
    this.map.getSource('road_guidance')?.setData(EMPTY_COLLECTION);
  }
}
