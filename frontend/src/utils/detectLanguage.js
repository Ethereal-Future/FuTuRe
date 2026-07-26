/**
 * Browser language detection utilities.
 *
 * Resolves the language FuTuRe should display on first (and subsequent)
 * visits: a previously-saved preference wins, otherwise the browser's
 * preferred languages are matched against the app's supported locales,
 * falling back to English when nothing matches.
 */

export const LANGUAGE_STORAGE_KEY = 'i18n_language';

/**
 * Read the user's previously saved language preference, if any.
 * @param {Storage} [storage]
 * @returns {string|null}
 */
export function getStoredLanguage(storage = safeLocalStorage()) {
  try {
    return storage?.getItem(LANGUAGE_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * Persist a manually-selected language preference so it is used in
 * preference to auto-detection on subsequent visits.
 * @param {string} lang
 * @param {Storage} [storage]
 */
export function storeLanguage(lang, storage = safeLocalStorage()) {
  try {
    storage?.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // localStorage unavailable (private browsing, disabled storage, SSR) — ignore.
  }
}

function safeLocalStorage() {
  return typeof window !== 'undefined' ? window.localStorage : undefined;
}

/**
 * Match a BCP 47 language tag against a list of supported codes, first by
 * exact match then by primary subtag (e.g. 'fr-CA' matches 'fr').
 * @param {string} candidate
 * @param {string[]} supportedCodes
 * @returns {string|null}
 */
export function matchSupportedLanguage(candidate, supportedCodes) {
  if (!candidate) return null;
  const normalized = candidate.toLowerCase();

  const exact = supportedCodes.find((code) => code.toLowerCase() === normalized);
  if (exact) return exact;

  const primarySubtag = normalized.split('-')[0];
  const bySubtag = supportedCodes.find((code) => code.toLowerCase() === primarySubtag);
  return bySubtag || null;
}

/**
 * Detect which supported language FuTuRe should use.
 * Preference order: saved preference -> navigator languages -> fallback.
 * @param {object} [options]
 * @param {string[]} options.supportedCodes  Language codes the app supports
 * @param {string} [options.fallback]  Used when nothing matches (default 'en')
 * @param {string|null} [options.storedLanguage]  Override for testing
 * @param {string[]} [options.navigatorLanguages]  Override for testing
 * @returns {string}
 */
export function detectLanguage({
  supportedCodes,
  fallback = 'en',
  storedLanguage = getStoredLanguage(),
  navigatorLanguages = (typeof navigator !== 'undefined' &&
    (navigator.languages?.length ? navigator.languages : [navigator.language])) || [],
} = {}) {
  if (storedLanguage) {
    const matched = matchSupportedLanguage(storedLanguage, supportedCodes);
    if (matched) return matched;
  }

  for (const candidate of navigatorLanguages) {
    const matched = matchSupportedLanguage(candidate, supportedCodes);
    if (matched) return matched;
  }

  return fallback;
}
