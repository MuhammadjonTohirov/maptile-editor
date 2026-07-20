// Admin-only bulk-load modal: pick a country, start the load, and watch a
// progress bar polled from the backend job. Only admins ever see the button.
import { ApiError, bulkApi } from './api.js';
import { t } from './strings.js';

const POLL_MS = 2500;

function countsText(counts) {
  if (!counts) return '';
  return Object.entries(counts).map(([type, n]) => `${type} ${n}`).join(' · ');
}

export class BulkLoadUI {
  constructor({ onComplete } = {}) {
    this.onComplete = onComplete;
    this.pollTimer = null;
    this.el = Object.fromEntries([
      'open-bulk-load', 'bulk-load-modal', 'bulk-load-close', 'bulk-load-country',
      'bulk-load-progress', 'bulk-load-stage', 'bulk-load-bar', 'bulk-load-error', 'bulk-load-start',
    ].map((id) => [id, document.getElementById(id)]));
    this.wire();
  }

  wire() {
    this.el['open-bulk-load']?.addEventListener('click', () => this.open());
    this.el['bulk-load-close']?.addEventListener('click', () => this.close());
    this.el['bulk-load-start']?.addEventListener('click', () => this.start());
  }

  setAdmin(isAdmin) {
    this.el['open-bulk-load'].hidden = !isAdmin;
  }

  async open() {
    this.el['bulk-load-error'].textContent = '';
    this.el['bulk-load-progress'].hidden = true;
    this.el['bulk-load-start'].disabled = false;
    try {
      const countries = await bulkApi.countries();
      this.el['bulk-load-country'].replaceChildren(
        ...countries.map((country) => new Option(country.label, country.key)));
    } catch {
      // The modal still opens; Start will surface any error.
    }
    this.el['bulk-load-modal'].hidden = false;
    // If a load is already in flight, jump straight to its progress.
    const running = await bulkApi.status().catch(() => null);
    if (running && running.status === 'running') this.trackProgress();
  }

  close() {
    this.stopPolling();
    this.el['bulk-load-modal'].hidden = true;
  }

  async start() {
    const country = this.el['bulk-load-country'].value;
    if (!country) return;
    this.el['bulk-load-error'].textContent = '';
    this.el['bulk-load-start'].disabled = true;
    try {
      await bulkApi.start(country);
      this.trackProgress();
    } catch (error) {
      this.el['bulk-load-start'].disabled = false;
      const busy = error instanceof ApiError && error.status === 409;
      this.el['bulk-load-error'].textContent = busy ? t('bulkLoadRunning') : (error.message || t('authError'));
    }
  }

  trackProgress() {
    this.el['bulk-load-progress'].hidden = false;
    this.el['bulk-load-start'].disabled = true;
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), POLL_MS);
  }

  async poll() {
    let state;
    try {
      state = await bulkApi.status();
    } catch {
      return;
    }
    this.el['bulk-load-bar'].style.width = `${state.progress || 0}%`;
    this.el['bulk-load-stage'].textContent = state.message || '';
    if (state.status === 'done') {
      this.stopPolling();
      this.el['bulk-load-stage'].textContent = t('bulkLoadDone', { counts: countsText(state.counts) });
      this.el['bulk-load-start'].disabled = false;
      this.onComplete?.();
    } else if (state.status === 'error') {
      this.stopPolling();
      this.el['bulk-load-error'].textContent = state.error || t('authError');
      this.el['bulk-load-start'].disabled = false;
    }
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
