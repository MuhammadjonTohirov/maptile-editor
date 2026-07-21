import { ApiError, routeApi } from './api.js';
import { t } from './strings.js';

const PROFILE_BUTTONS = {
  foot: 'route-profile-foot',
  bicycle: 'route-profile-bicycle',
  car: 'route-profile-car',
};

export class RouteUI {
  constructor({ map, elements, onStatus, onArm }) {
    this.map = map;
    this.elements = elements;
    this.onStatus = onStatus;
    this.onArm = onArm;
    this.picking = null;
    this.profile = 'foot';
    this.points = { a: null, b: null };
    this.computeRevision = 0;

    elements['find-route'].addEventListener('click', () => this.arm());
    elements['clear-route'].addEventListener('click', () => this.clear());
    for (const [profile, elementId] of Object.entries(PROFILE_BUTTONS)) {
      elements[elementId].addEventListener('click', () => this.setProfile(profile));
    }
  }

  arm() {
    this.clear();
    this.onArm();
    this.picking = 'a';
    this.elements['clear-route'].disabled = false;
    this.show(t('routePickA'));
  }

  handleMapClick(event) {
    if (!this.picking) return false;
    const coordinate = [event.lngLat.lng, event.lngLat.lat];
    if (this.picking === 'a') {
      this.points.a = coordinate;
      this.picking = 'b';
      this.show(t('routePickB'));
    } else {
      this.points.b = coordinate;
      this.picking = null;
      this.compute();
    }
    this.renderPoints();
    return true;
  }

  handleKeydown(event) {
    if (event.key !== 'Escape' || !this.picking) return false;
    this.clear();
    return true;
  }

  setProfile(profile) {
    this.profile = profile;
    Object.values(PROFILE_BUTTONS).forEach((id) => this.elements[id].classList.remove('active'));
    this.elements[PROFILE_BUTTONS[profile]].classList.add('active');
    if (this.points.a && this.points.b) this.compute();
  }

  renderPoints() {
    const features = Object.entries(this.points)
      .filter(([, coordinate]) => coordinate)
      .map(([role, coordinate]) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coordinate },
        properties: { role },
      }));
    this.map.getSource('route_points')?.setData({ type: 'FeatureCollection', features });
  }

  async compute() {
    const revision = ++this.computeRevision;
    this.elements['route-status'].textContent = t('routeComputing');
    try {
      const result = await routeApi.find(this.points.a, this.points.b, this.profile);
      if (revision !== this.computeRevision) return;
      this.map.getSource('route_line')?.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: result.geometry, properties: {} }],
      });
      this.show(t('routeResult', {
        km: (result.distance_m / 1000).toFixed(1),
        minutes: Math.round(result.duration_s / 60),
      }));
    } catch (error) {
      if (revision !== this.computeRevision) return;
      this.map.getSource('route_line')?.setData({ type: 'FeatureCollection', features: [] });
      let message = t('routeFailed');
      if (error instanceof ApiError && error.status === 404) message = t('routeNotFound');
      else if (error instanceof ApiError && error.status === 409) message = t('routeNetworkNotReady');
      this.show(message, true);
      console.error('Unable to compute route', error);
    }
  }

  show(message, isError = false) {
    this.elements['route-status'].textContent = message;
    this.onStatus(message, isError);
  }

  clear() {
    this.computeRevision += 1;
    this.picking = null;
    this.points = { a: null, b: null };
    this.elements['clear-route'].disabled = true;
    this.elements['route-status'].textContent = '';
    this.map.getSource('route_points')?.setData({ type: 'FeatureCollection', features: [] });
    this.map.getSource('route_line')?.setData({ type: 'FeatureCollection', features: [] });
  }
}
