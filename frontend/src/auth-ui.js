// Login gate + user-management panel for the editor (rule F2 keeps HTTP in
// api.js; this owns only the auth UI). The editor page stays unusable behind a
// full-screen overlay until a user signs in; admins get a user panel. The
// public client viewer (client.html) has no auth and never loads this.
import { ApiError, authApi } from './api.js';
import { t } from './strings.js';

// The admin panel has a shareable URL (/admin). It is not a separate page —
// nginx serves the editor for any path — so this just deep-links into the panel.
function isAdminRoute() {
  return window.location.pathname.replace(/\/+$/, '') === '/admin';
}

const ELEMENT_IDS = [
  'login-overlay', 'login-form', 'login-username', 'login-password', 'login-error', 'login-submit',
  'user-chip', 'user-name', 'logout-btn', 'admin-open',
  'admin-panel', 'admin-close', 'admin-users', 'admin-new-username', 'admin-new-password',
  'admin-new-admin', 'admin-create', 'admin-error',
];

export class AuthController {
  constructor({ onAuthenticated, onLoggedOut } = {}) {
    this.user = null;
    this.userNames = new Map(); // id -> username, for audit display
    this.onAuthenticated = onAuthenticated;
    this.onLoggedOut = onLoggedOut;
    this.el = Object.fromEntries(ELEMENT_IDS.map((id) => [id, document.getElementById(id)]));
    this.wire();
  }

  wire() {
    this.el['login-form']?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitLogin();
    });
    this.el['logout-btn']?.addEventListener('click', () => this.logout());
    this.el['admin-open']?.addEventListener('click', () => this.openAdmin());
    this.el['admin-close']?.addEventListener('click', () => {
      this.el['admin-panel'].hidden = true;
      // Leaving /admin: drop the path but keep the map view in the fragment.
      if (isAdminRoute()) window.history.replaceState(null, '', `/${window.location.hash}`);
    });
    this.el['admin-create']?.addEventListener('click', () => this.createUser());
    // Any 401 from anywhere (expired session mid-edit) re-shows the login gate.
    window.addEventListener('auth:required', () => { if (this.user) this.showLogin(); });
  }

  async init() {
    try {
      this.user = await authApi.me();
      await this.enter();
    } catch {
      this.showLogin();
    }
  }

  async enter() {
    this.el['login-error'].textContent = '';
    this.el['login-overlay'].hidden = true;
    this.el['user-name'].textContent = this.user.username;
    this.el['user-chip'].hidden = false;
    this.el['admin-open'].hidden = !this.user.is_admin;
    await this.refreshUserNames();
    this.onAuthenticated?.(this.user);
    // Deep link: /admin opens the user panel straight away for admins (after a
    // login prompt if needed). The map view still lives in the URL fragment.
    if (this.user.is_admin && isAdminRoute()) this.openAdmin();
  }

  showLogin() {
    const wasSignedIn = !!this.user;
    this.user = null;
    this.el['user-chip'].hidden = true;
    this.el['admin-open'].hidden = true;
    this.el['admin-panel'].hidden = true;
    this.el['login-overlay'].hidden = false;
    this.el['login-username']?.focus();
    if (wasSignedIn) this.onLoggedOut?.();
  }

  async submitLogin() {
    const username = this.el['login-username'].value.trim();
    const password = this.el['login-password'].value;
    if (!username || !password) return;
    this.el['login-error'].textContent = '';
    this.el['login-submit'].disabled = true;
    try {
      this.user = await authApi.login(username, password);
      this.el['login-password'].value = '';
      await this.enter();
    } catch (error) {
      const invalid = error instanceof ApiError && error.status === 401;
      this.el['login-error'].textContent = invalid ? t('authInvalid') : t('authError');
    } finally {
      this.el['login-submit'].disabled = false;
    }
  }

  async logout() {
    try {
      await authApi.logout();
    } catch {
      // Clear the session locally regardless of the network result.
    }
    this.showLogin();
  }

  isAdmin() {
    return !!this.user?.is_admin;
  }

  // --- Audit: resolve created_by/updated_by ids to usernames ---------------
  async refreshUserNames() {
    try {
      const users = await authApi.listUsers();
      this.userNames = new Map(users.map((user) => [user.id, user.username]));
    } catch {
      // Non-fatal: the panel falls back to showing the raw id.
    }
  }

  userName(id) {
    if (id === null || id === undefined) return null;
    return this.userNames.get(id) || `#${id}`;
  }

  // --- Admin panel ----------------------------------------------------------
  async openAdmin() {
    this.el['admin-panel'].hidden = false;
    this.el['admin-error'].textContent = '';
    await this.renderUsers();
  }

  async renderUsers() {
    const list = this.el['admin-users'];
    let users = [];
    try {
      users = await authApi.listUsers();
    } catch (error) {
      this.el['admin-error'].textContent = error.message || t('authError');
      return;
    }
    this.userNames = new Map(users.map((user) => [user.id, user.username]));
    list.replaceChildren(...users.map((user) => this.userRow(user)));
  }

  userRow(user) {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = user.username
      + (user.is_admin ? ` ${t('authAdminBadge')}` : '')
      + (user.is_active ? '' : ` · ${t('authInactive')}`);
    if (!user.is_active) label.classList.add('inactive');

    const actions = document.createElement('span');
    actions.className = 'admin-actions';
    const isSelf = user.id === this.user.id;
    if (!isSelf) {
      actions.append(
        this.actionButton(user.is_active ? t('authDeactivate') : t('authActivate'),
          () => this.patchUser(user.id, { is_active: !user.is_active })),
        this.actionButton(user.is_admin ? t('authRevokeAdmin') : t('authMakeAdmin'),
          () => this.patchUser(user.id, { is_admin: !user.is_admin })),
      );
    }
    actions.append(this.actionButton(t('authResetPassword'), () => this.resetPassword(user)));
    row.append(label, actions);
    return row;
  }

  actionButton(text, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', handler);
    return button;
  }

  async patchUser(id, payload) {
    this.el['admin-error'].textContent = '';
    try {
      await authApi.updateUser(id, payload);
      await this.renderUsers();
    } catch (error) {
      this.el['admin-error'].textContent = error.message || t('authError');
    }
  }

  resetPassword(user) {
    const next = window.prompt(t('authNewPasswordFor', { name: user.username }));
    if (!next) return;
    if (next.length < 8) {
      this.el['admin-error'].textContent = t('authPasswordTooShort');
      return;
    }
    this.patchUser(user.id, { password: next });
  }

  async createUser() {
    const username = this.el['admin-new-username'].value.trim();
    const password = this.el['admin-new-password'].value;
    const isAdmin = this.el['admin-new-admin'].checked;
    this.el['admin-error'].textContent = '';
    if (!username || password.length < 8) {
      this.el['admin-error'].textContent = t('authPasswordTooShort');
      return;
    }
    try {
      await authApi.createUser({ username, password, is_admin: isAdmin });
      this.el['admin-new-username'].value = '';
      this.el['admin-new-password'].value = '';
      this.el['admin-new-admin'].checked = false;
      await this.renderUsers();
    } catch (error) {
      const exists = error instanceof ApiError && error.status === 409;
      this.el['admin-error'].textContent = exists ? t('authUserExists') : (error.message || t('authError'));
    }
  }
}
