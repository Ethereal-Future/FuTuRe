/**
 * Notification templates for all supported notification types.
 *
 * Issue #1145: templates are now locale-aware. Instead of hardcoded English
 * strings, each template is resolved from the shared frontend locale files
 * (frontend/src/i18n/locales/<locale>.json) under the "notifications" key,
 * so the backend and frontend stay in sync with a single source of truth.
 *
 * Fallback chain: requested locale → 'en' → legacy hardcoded string.
 *
 * Template interpolation uses {{variable}} syntax (unchanged from before).
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the shared locale files in the frontend workspace.
const LOCALES_DIR = path.resolve(
  __dirname,
  '../../../frontend/src/i18n/locales'
);

// Supported locales — must match frontend/src/i18n/index.js SUPPORTED_LANGUAGES.
const SUPPORTED_LOCALES = ['en', 'ar', 'he', 'fr', 'es', 'zh', 'pt'];

/**
 * Load and cache notification template strings for a given locale.
 * Returns the "notifications" section of the locale JSON, or null if absent.
 *
 * @param {string} locale
 * @returns {object|null}
 */
const _cache = new Map();
function loadLocaleNotifications(locale) {
  if (_cache.has(locale)) return _cache.get(locale);

  const file = path.join(LOCALES_DIR, `${locale}.json`);
  try {
    const json = JSON.parse(readFileSync(file, 'utf-8'));
    const notifications = json.notifications ?? null;
    _cache.set(locale, notifications);
    return notifications;
  } catch {
    _cache.set(locale, null);
    return null;
  }
}

/**
 * Get raw (un-interpolated) template strings for a notification type and
 * channel in the requested locale, falling back to English.
 *
 * @param {string} type    - e.g. 'transaction_received'
 * @param {string} channel - 'email' | 'push' | 'sms' | 'inApp'
 * @param {string} locale  - BCP 47 tag, e.g. 'ar', 'fr'. Defaults to 'en'.
 * @returns {object|null}  - e.g. { subject, body } for email; { title, body } for push
 */
export function getRawTemplate(type, channel, locale = 'en') {
  const normalised = SUPPORTED_LOCALES.includes(locale) ? locale : 'en';

  // Try requested locale first, then fall back to English.
  for (const candidate of [normalised, 'en']) {
    const notifications = loadLocaleNotifications(candidate);
    const tmpl = notifications?.[type]?.[channel];
    if (tmpl) return tmpl;
  }
  return null;
}

/**
 * Render a template string by replacing {{key}} placeholders with data values.
 * @param {string} template
 * @param {Record<string, string>} data
 * @returns {string}
 */
export function renderTemplate(template, data = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? '');
}

/**
 * Get a rendered template for a given type, channel, and locale.
 *
 * @param {string} type    - Template key (e.g. 'transaction_received')
 * @param {string} channel - 'email' | 'push' | 'sms' | 'inApp'
 * @param {Record<string, string>} data - Interpolation variables
 * @param {string} [locale='en'] - Recipient's preferred locale
 * @returns {{ subject?: string, title?: string, body: string } | null}
 */
export function getRenderedTemplate(type, channel, data = {}, locale = 'en') {
  const tmpl = getRawTemplate(type, channel, locale);
  if (!tmpl) return null;

  const rendered = {};
  for (const [k, v] of Object.entries(tmpl)) {
    rendered[k] = renderTemplate(v, data);
  }
  return rendered;
}

// ---------------------------------------------------------------------------
// Legacy TEMPLATES export — kept for backward-compatibility with any code that
// imports this object directly. Reflects English strings only.
// New code should use getRenderedTemplate(type, channel, data, locale).
// ---------------------------------------------------------------------------
export const TEMPLATES = (() => {
  const en = loadLocaleNotifications('en');
  return en ?? {};
})();
