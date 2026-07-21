import { ApiError, routeApi } from './api.js';
import { t } from './strings.js';

export class RoadNetworkUI {
  constructor({ button, onStatus }) {
    this.button = button;
    this.onStatus = onStatus;
    this.pollTimer = null;
    this.isAdmin = false;
    button.addEventListener('click', () => this.start());
  }

  setAdmin(isAdmin) {
    this.isAdmin = isAdmin;
    this.button.hidden = !isAdmin;
    if (isAdmin) this.resume();
    else this.stopPolling();
  }

  async start() {
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
    this.onStatus(t('roadNetworkRebuildStarted'));
    this.poll();
  }

  async resume() {
    if (!this.isAdmin) return;
    try {
      const status = await routeApi.rebuildStatus();
      if (status.status !== 'running') return;
      this.button.disabled = true;
      this.onStatus(t('roadNetworkRebuildStarted'));
      this.poll();
    } catch (error) {
      console.error('Unable to resume road network rebuild status', error);
    }
  }

  async poll() {
    if (!this.isAdmin) return;
    this.stopPolling();
    let status;
    try {
      status = await routeApi.rebuildStatus();
    } catch (error) {
      console.error('Unable to read road network rebuild status', error);
      this.button.disabled = false;
      return;
    }
    if (!this.isAdmin) return;
    if (status.status === 'running') {
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
  }

  stopPolling() {
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }
}
