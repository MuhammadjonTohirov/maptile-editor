// Locale-aware string catalog (rule F7). Every user-visible string lives in
// one catalog per language under locales/; English is the reference and the
// fallback for any missing key.
import en from './locales/en.js';
import ru from './locales/ru.js';
import uz from './locales/uz.js';

export const LOCALES = { uz, ru, en };
const STORAGE_KEY = 'maptile-locale';

// localStorage throws in some private-browsing modes; the app must still run.
function savedLocale() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberLocale(code) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // The choice simply won't persist.
  }
}

// ?lang= override (also persisted) → saved choice → browser language → English.
function resolveLocale() {
  const requested = new URLSearchParams(window.location.search).get('lang');
  if (requested && Object.hasOwn(LOCALES, requested)) {
    rememberLocale(requested);
    return requested;
  }
  const saved = savedLocale();
  if (saved && Object.hasOwn(LOCALES, saved)) return saved;
  for (const language of navigator.languages ?? [navigator.language]) {
    const code = (language ?? '').slice(0, 2).toLowerCase();
    if (Object.hasOwn(LOCALES, code)) return code;
  }
  return 'en';
}

const locale = resolveLocale();
document.documentElement.lang = locale;

export function currentLocale() {
  return locale;
}

// The view lives in the URL hash, so reloading re-renders the same map view
// in the new language. A stale ?lang= override is dropped so the saved
// choice wins on the next load.
export function setLocale(code) {
  if (!Object.hasOwn(LOCALES, code) || code === locale) return;
  rememberLocale(code);
  const url = new URL(window.location.href);
  url.searchParams.delete('lang');
  window.location.replace(url);
}

export function t(key, params = {}) {
  let message = LOCALES[locale][key] ?? en[key] ?? key;
  for (const [name, value] of Object.entries(params)) {
    message = message.replaceAll(`{${name}}`, String(value));
  }
  return message;
}

// Applies the catalog to static markup: data-i18n replaces an element's text,
// data-i18n-<attribute> variants set the named attribute.
const ATTRIBUTE_MARKERS = {
  'data-i18n-placeholder': 'placeholder',
  'data-i18n-title': 'title',
  'data-i18n-aria-label': 'aria-label',
  'data-i18n-content': 'content',
};

export function localizeDocument(root = document) {
  for (const element of root.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.getAttribute('data-i18n'));
  }
  for (const [marker, attribute] of Object.entries(ATTRIBUTE_MARKERS)) {
    for (const element of root.querySelectorAll(`[${marker}]`)) {
      element.setAttribute(attribute, t(element.getAttribute(marker)));
    }
  }
}

// Overrides for the strings MapLibre's built-in controls render themselves.
export function mapLibreLocale() {
  return {
    'NavigationControl.ZoomIn': t('mapZoomIn'),
    'NavigationControl.ZoomOut': t('mapZoomOut'),
    'NavigationControl.ResetBearing': t('mapResetBearing'),
  };
}
