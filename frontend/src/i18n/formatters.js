/**
 * Locale-aware formatting utilities.
 * All functions accept an optional `locale` parameter (BCP 47 tag).
 * When omitted they fall back to the current i18n language or browser default.
 */

import i18n from './index';

function currentLocale() {
  return i18n.language || navigator.language || 'en';
}

/**
 * Format a number for the current locale.
 * @param {number} value
 * @param {Intl.NumberFormatOptions} [options]
 * @param {string} [locale]
 */
export function formatNumber(value, options = {}, locale = currentLocale()) {
  return new Intl.NumberFormat(locale, options).format(value);
}

/**
 * Format a currency amount.
 * @param {number} amount
 * @param {string} currency  ISO 4217 code, e.g. 'USD', 'EUR'
 * @param {string} [locale]
 */
export function formatCurrency(amount, currency, locale = currentLocale()) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  }).format(amount);
}

/**
 * Format a date/time value.
 * @param {Date|number|string} value
 * @param {Intl.DateTimeFormatOptions} [options]
 * @param {string} [locale]
 */
export function formatDate(value, options = { dateStyle: 'medium' }, locale = currentLocale()) {
  return new Intl.DateTimeFormat(locale, options).format(new Date(value));
}

/**
 * Format a date+time.
 * @param {Date|number|string} value
 * @param {string} [locale]
 */
export function formatDateTime(value, locale = currentLocale()) {
  return formatDate(value, { dateStyle: 'medium', timeStyle: 'short' }, locale);
}

/**
 * Format a relative time (e.g. "3 minutes ago").
 * @param {Date|number} value  Past or future date
 * @param {string} [locale]
 */
export function formatRelativeTime(value, locale = currentLocale()) {
  const diffMs = new Date(value) - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  const thresholds = [
    [60, 'second', 1],
    [3600, 'minute', 60],
    [86400, 'hour', 3600],
    [Infinity, 'day', 86400],
  ];

  for (const [limit, unit, divisor] of thresholds) {
    if (Math.abs(diffSec) < limit) {
      return rtf.format(Math.round(diffSec / divisor), unit);
    }
  }
}

/**
 * Map a locale code to its preferred currency code.
 * Falls back to USD for unknown locales.
 */
const LOCALE_CURRENCY_MAP = {
  en: 'USD', 'en-GB': 'GBP', 'en-AU': 'AUD', 'en-CA': 'CAD',
  ar: 'SAR', 'ar-AE': 'AED', 'ar-EG': 'EGP',
  he: 'ILS',
  fr: 'EUR', 'fr-CH': 'CHF',
  es: 'EUR', 'es-MX': 'MXN', 'es-AR': 'ARS', 'es-CO': 'COP',
  zh: 'CNY', 'zh-TW': 'TWD', 'zh-HK': 'HKD',
  pt: 'EUR', 'pt-BR': 'BRL',
};

/**
 * Get the preferred currency code for a locale.
 * @param {string} [locale]
 * @returns {string} ISO 4217 currency code
 */
export function getLocaleCurrency(locale = currentLocale()) {
  return LOCALE_CURRENCY_MAP[locale]
    ?? LOCALE_CURRENCY_MAP[locale.split('-')[0]]
    ?? 'USD';
}
