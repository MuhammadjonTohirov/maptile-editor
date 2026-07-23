import { ApiError, routeApi } from './api.js';
import { routeExportFilename, routeExportJson } from './route-export.js';
import { currentLocale, t } from './strings.js';

const PROFILE_BUTTONS = {
  foot: 'route-profile-foot',
  bicycle: 'route-profile-bicycle',
  car: 'route-profile-car',
};

const PROFILE_LABELS = {
  foot: 'routeProfileFoot',
  bicycle: 'routeProfileBicycle',
  car: 'routeProfileCar',
};

const MANEUVERS = {
  depart: ['routeManeuverDepart', '●'],
  straight: ['routeManeuverStraight', '↑'],
  slight_left: ['routeManeuverSlightLeft', '↖'],
  left: ['routeManeuverLeft', '←'],
  slight_right: ['routeManeuverSlightRight', '↗'],
  right: ['routeManeuverRight', '→'],
  uturn: ['routeManeuverUturn', '↶'],
  arrive: ['routeManeuverArrive', '◆'],
};

function formatDistance(metres) {
  if (metres < 1000) {
    return t('routeDistanceMetres', { metres: Math.round(metres) });
  }
  const kilometres = new Intl.NumberFormat(currentLocale(), {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(metres / 1000);
  return t('routeDistanceKilometres', { kilometres });
}

function formatDuration(seconds) {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours
    ? t('routeDurationHours', { hours, minutes })
    : t('routeDurationMinutes', { minutes: totalMinutes });
}

function formatCoordinate(coordinate) {
  const number = new Intl.NumberFormat(currentLocale(), {
    minimumFractionDigits: 5,
    maximumFractionDigits: 5,
    useGrouping: false,
  });
  return `${number.format(coordinate[1])}, ${number.format(coordinate[0])}`;
}

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
    this.networkOutdated = false;
    this.result = null;
    this.resultProfile = null;

    elements['find-route'].addEventListener('click', () => this.arm());
    elements['clear-route'].addEventListener('click', () => this.clear());
    elements['route-details'].addEventListener('click', () => this.openDetails());
    elements['route-details-close'].addEventListener('click', () => this.closeDetails());
    elements['route-details-modal'].addEventListener('click', (event) => {
      if (event.target === elements['route-details-modal']) this.closeDetails();
    });
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
    if (event.key !== 'Escape') return false;
    if (!this.elements['route-details-modal'].hidden) {
      this.closeDetails();
      return true;
    }
    if (!this.picking) return false;
    this.clear();
    return true;
  }

  setProfile(profile) {
    this.profile = profile;
    Object.values(PROFILE_BUTTONS).forEach((id) => this.elements[id].classList.remove('active'));
    this.elements[PROFILE_BUTTONS[profile]].classList.add('active');
    this.closeDetails();
    this.renderPoints();
    if (this.points.a && this.points.b) this.compute();
  }

  renderPoints() {
    const features = Object.entries(this.points)
      .filter(([, coordinate]) => coordinate)
      .map(([role, coordinate]) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coordinate },
        properties: { role, label: role.toUpperCase(), profile: this.profile },
      }));
    this.map.getSource('route_points')?.setData({ type: 'FeatureCollection', features });
  }

  async compute() {
    const revision = ++this.computeRevision;
    this.result = null;
    this.resultProfile = null;
    this.elements['route-details'].disabled = true;
    this.elements['route-status'].textContent = t('routeComputing');
    try {
      const result = await routeApi.find(this.points.a, this.points.b, this.profile);
      if (revision !== this.computeRevision) return;
      this.result = result;
      this.resultProfile = this.profile;
      this.map.getSource('route_line')?.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: result.geometry,
          properties: { profile: this.profile },
        }],
      });
      this.elements['route-details'].disabled = false;
      this.networkOutdated = Boolean(result.network_stale);
      this.show(t(result.network_stale ? 'routeResultOutdated' : 'routeResult', {
        km: (result.distance_m / 1000).toFixed(1),
        minutes: Math.max(1, Math.round(result.duration_s / 60)),
      }), Boolean(result.network_stale));
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

  openDetails() {
    if (!this.result) return;
    this.renderDetails();
    this.downloadRouteJson();
    this.elements['route-details-modal'].hidden = false;
    this.elements['route-details-close'].focus();
  }

  downloadRouteJson() {
    const json = routeExportJson(this.result, this.resultProfile, this.points);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = routeExportFilename(this.resultProfile);
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  closeDetails() {
    const wasOpen = !this.elements['route-details-modal'].hidden;
    this.elements['route-details-modal'].hidden = true;
    if (wasOpen) this.elements['route-details'].focus();
  }

  renderDetails() {
    const profile = t(PROFILE_LABELS[this.resultProfile]);
    this.elements['route-details-summary'].textContent = t('routeDetailsSummary', {
      profile,
      distance: formatDistance(this.result.distance_m),
      duration: formatDuration(this.result.duration_s),
    });
    this.elements['route-details-json'].textContent = routeExportJson(
      this.result,
      this.resultProfile,
      this.points,
    );
    const steps = (this.result.steps || []).map((step) => {
      const [labelKey, symbol] = MANEUVERS[step.maneuver] || MANEUVERS.straight;
      const item = document.createElement('li');
      item.className = 'route-step';
      const icon = document.createElement('span');
      icon.className = 'route-step-icon';
      icon.textContent = symbol;
      icon.setAttribute('aria-hidden', 'true');
      const content = document.createElement('span');
      content.className = 'route-step-content';
      const instruction = document.createElement('strong');
      instruction.textContent = t(labelKey);
      const location = document.createElement('span');
      location.textContent = step.road_name || formatCoordinate(step.coordinate);
      content.append(instruction, location);
      const distance = document.createElement('span');
      distance.className = 'route-step-distance';
      distance.textContent = formatDistance(step.distance_m);
      item.append(icon, content, distance);
      return item;
    });
    this.elements['route-details-list'].replaceChildren(...steps);
  }

  show(message, isError = false) {
    this.elements['route-status'].textContent = message;
    this.onStatus(message, isError);
  }

  invalidateNetwork() {
    this.computeRevision += 1;
    this.networkOutdated = true;
    this.result = null;
    this.resultProfile = null;
    this.closeDetails();
    this.elements['route-details'].disabled = true;
    this.map.getSource('route_line')?.setData({ type: 'FeatureCollection', features: [] });
    if (this.points.a || this.points.b) {
      this.elements['clear-route'].disabled = false;
      this.show(t('routeOutdated'), true);
    }
  }

  async refreshAfterRebuild() {
    this.networkOutdated = false;
    if (this.points.a && this.points.b) await this.compute();
  }

  clear() {
    this.computeRevision += 1;
    this.picking = null;
    this.points = { a: null, b: null };
    this.networkOutdated = false;
    this.result = null;
    this.resultProfile = null;
    this.closeDetails();
    this.elements['clear-route'].disabled = true;
    this.elements['route-details'].disabled = true;
    this.elements['route-status'].textContent = '';
    this.map.getSource('route_points')?.setData({ type: 'FeatureCollection', features: [] });
    this.map.getSource('route_line')?.setData({ type: 'FeatureCollection', features: [] });
  }
}
