import { ApiError, routeApi } from './api.js';
import { t } from './strings.js';

export function networkStatePresentation(status) {
  if (status?.status === 'running') return { key: 'roadNetworkStateRebuilding', tone: 'rebuilding' };
  if (status?.is_stale) return { key: 'roadNetworkStateStale', tone: 'stale' };
  if (!status?.published_at) return { key: 'roadNetworkStateMissing', tone: 'stale' };
  return { key: 'roadNetworkStateFresh', tone: 'fresh' };
}

export class RoadNetworkUI {
  constructor({ button, stateElement, onStatus, onRebuilt }) {
    this.button = button;
    this.stateElement = stateElement;
    this.onStatus = onStatus;
    this.onRebuilt = onRebuilt;
    this.pollTimer = null;
    this.isAdmin = false;
    this.hasUser = false;
    this.lastStatus = null;
    this.wasRunning = false;
    button.addEventListener('click', () => this.start());
  }

  setUser(user) {
    this.hasUser = Boolean(user);
    this.isAdmin = Boolean(user?.is_admin);
    this.button.hidden = !this.isAdmin;
    if (this.hasUser) this.resume();
    else this.stopPolling();
  }

  async start() {
    if (!this.isAdmin) return;
    this.button.disabled = true;
    try {
      await routeApi.rebuild();
    } catch (error) {
      // The job is single-flight. Reconnect to an existing build rather than
      // displaying its protective 409 as a failure.
      if (!(error instanceof ApiError && error.status === 409)) {
        console.error('Unable to start road network rebuild', error);
        this.onStatus(t('roadNetworkRebuildFailed'), true);
        this.button.disabled = false;
        return;
      }
    }
    this.wasRunning = true;
    this.render({ ...(this.lastStatus || {}), status: 'running' });
    this.onStatus(t('roadNetworkRebuildStarted'));
    this.poll();
  }

  async resume() {
    if (!this.hasUser) return;
    try {
      const status = await routeApi.rebuildStatus();
      this.lastStatus = status;
      this.render(status);
      if (status.status !== 'running') return;
      this.wasRunning = true;
      this.button.disabled = true;
      this.poll();
    } catch (error) {
      console.error('Unable to resume road network rebuild status', error);
    }
  }

  async refresh() {
    if (!this.hasUser) return;
    try {
      const status = await routeApi.rebuildStatus();
      this.lastStatus = status;
      this.render(status);
    } catch (error) {
      console.error('Unable to read road network status', error);
    }
  }

  markStale() {
    this.lastStatus = { ...(this.lastStatus || {}), is_stale: true };
    this.render(this.lastStatus);
  }

  render(status) {
    const presentation = networkStatePresentation(status);
    this.stateElement.textContent = t(presentation.key);
    this.stateElement.dataset.state = presentation.tone;
  }

  async poll() {
    if (!this.hasUser) return;
    this.stopPolling();
    let status;
    try {
      status = await routeApi.rebuildStatus();
    } catch (error) {
      console.error('Unable to read road network rebuild status', error);
      this.button.disabled = false;
      return;
    }
    if (!this.hasUser) return;
    this.lastStatus = status;
    this.render(status);
    if (status.status === 'running') {
      this.wasRunning = true;
      this.onStatus(t('roadNetworkRebuildProgress', {
        progress: status.progress ?? 0,
        processed: status.roads_processed ?? 0,
        total: status.roads_total ?? 0,
        edges: status.edge_count ?? status.segments_total ?? 0,
      }));
      this.pollTimer = setTimeout(() => this.poll(), 2000);
      return;
    }
    this.button.disabled = false;
    this.onStatus(
      status.status === 'done'
        ? t('roadNetworkRebuildDone', { count: status.edge_count })
        : t('roadNetworkRebuildFailed'),
      status.status !== 'done',
    );
    if (this.wasRunning && status.status === 'done' && !status.is_stale) {
      this.wasRunning = false;
      await this.onRebuilt?.(status);
    }
  }

  stopPolling() {
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }
}
