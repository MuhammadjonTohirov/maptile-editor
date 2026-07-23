import maplibregl from 'maplibre-gl/dist/maplibre-gl-csp.js';
import 'maplibre-gl/dist/maplibre-gl.css';
import { mapLibreLocale } from './strings.js';

// Replaced at build time with the hashed, separately deployed MapLibre worker.
// Keeping worker code out of the main runtime chunk prevents one monolithic
// megabyte-scale download while preserving MapLibre's normal worker model.
maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);
export { maplibregl };

// One map bootstrap for the editor and the client (rule F1), so view
// defaults and request handling can never drift apart.
export function createMap(container = 'map') {
  return new maplibregl.Map({
    container,
    style: '/styles/editor.json',
    locale: mapLibreLocale(),
    center: [64.5853, 41.3775],
    zoom: 5.4,
    maxZoom: 20,
    // The view lives in the URL fragment so a location can be shared or
    // reloaded in place, in the editor and the client alike.
    hash: true,
    // MapLibre fetches vector tiles inside a worker, where relative URLs do
    // not have the page's origin. Keep the style portable while resolving
    // every same-origin resource before it is handed to the worker.
    transformRequest: (url) => ({ url: new URL(url, window.location.origin).href }),
  });
}

export function addBaseControls(map) {
  map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');
}
