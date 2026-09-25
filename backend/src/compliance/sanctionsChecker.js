// Sanctions screening — integrates with the OFAC SDN API and the locally
// synchronized SanctionsEntity table (see sanctionsSync.js).
// Set SANCTIONS_API_KEY and SANCTIONS_API_URL in your environment.
//
// Fail mode (SANCTIONS_FAIL_MODE, default 'closed'): when the API is
// unconfigured or unreachable, 'closed' blocks the check as a hit pending
// manual review rather than silently passing everyone. Production and
// staging additionally refuse to start at all without SANCTIONS_API_KEY.
//
// Fuzzy matching: names are normalized (honorifics stripped, punctuation
// removed, tokens sorted) and compared using Double Metaphone phonetic keys
// plus Damerau-Levenshtein / Jaro-Winkler similarity so transliterated and
// misspelled variants of sanctioned names are still caught.

import https from 'https';
import logger from '../config/logger.js';
import prisma from '../config/prisma.js';
import redis from '../config/redis.js';

const API_URL  = process.env.SANCTIONS_API_URL  ?? 'https://api.ofac-api.com/v4/search';
const API_KEY  = process.env.SANCTIONS_API_KEY  ?? '';
const MIN_SCORE = parseInt(process.env.SANCTIONS_MIN_SCORE ?? '85', 10);
const FAIL_MODE = (process.env.SANCTIONS_FAIL_MODE ?? 'closed').trim().toLowerCase();
const APP_ENV = (process.env.APP_ENV || process.env.NODE_ENV || 'development').trim().toLowerCase();
const IS_DEPLOYED = APP_ENV === 'production' || APP_ENV === 'staging';

const CACHE_TTL_SECONDS = parseInt(process.env.SANCTIONS_CACHE_TTL ?? '3600', 10);
const CACHE_PREFIX = 'sanctions:screen:';
// Similarity threshold above which a fuzzy match is flagged for manual review.
const FUZZY_THRESHOLD = parseFloat(process.env.SANCTIONS_FUZZY_THRESHOLD ?? '0.85');

if (!API_KEY && IS_DEPLOYED) {
  throw new Error(
    `SANCTIONS_API_KEY is not configured; sanctions screening cannot start in ${APP_ENV}. ` +
    'Set SANCTIONS_API_KEY before deploying.'
  );
}

const sanctionsLogger = logger.child({ component: 'sanctions' });

// Honorifics / titles that carry no screening value and are stripped before
// comparison so "Mr. Vladimir Putin" matches "Putin, Vladimir".
const HONORIFICS = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'professor', 'sir', 'madam',
  'lord', 'lady', 'sheikh', 'shaikh', 'shaykh', 'haji', 'hajji', 'haj',
  'imam', 'rabbi', 'father', 'sister', 'brother', 'general', 'gen',
  'colonel', 'col', 'captain', 'capt', 'major', 'maj', 'lieutenant', 'lt',
  'sergeant', 'sgt', 'president', 'prime', 'minister', 'king', 'queen',
  'prince', 'princess', 'emir', 'amir', 'sultan', 'ayatollah', 'mullah',
]);

/**
 * Normalize a name for fuzzy comparison: lowercase, strip honorifics and
 * punctuation, collapse whitespace, and sort tokens alphabetically
 * (Token Sort Ratio) so inverted name order still matches.
 * @param {string} name
 * @returns {string[]} sorted, normalized name tokens
 */
export function normalizeAndTokenizeName(name) {
  if (!name || typeof name !== 'string') return [];
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !HONORIFICS.has(t))
    .sort();
}

// --- Double Metaphone ------------------------------------------------------
// Compact implementation returning primary and secondary phonetic keys.
// Handles the common transliteration sound-alikes (ph/f, c/k, z/s, etc.).
const DM_RULES = [
  [/^(kn|gn|pn|ae|wr)/, 'N'],
  [/^x/, 'S'],
  [/^wh/, 'W'],
  [/ph/, 'F'],
  [/gh/, 'K'],
  [/ch/, 'X'],
  [/sh/, 'X'],
  [/th/, '0'],
  [/ck/, 'K'],
  [/q/, 'K'],
  [/c(?=[iey])/, 'S'],
  [/c/, 'K'],
  [/z/, 'S'],
  [/v/, 'F'],
  [/w/, 'W'],
  [/y/, 'Y'],
  [/x/, 'KS'],
];

/**
 * Generate Double Metaphone primary/secondary phonetic keys for a token.
 * @param {string} token
 * @returns {{ primary: string, secondary: string }}
 */
export function doubleMetaphone(token) {
  if (!token) return { primary: '', secondary: '' };
  let word = token.toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return { primary: '', secondary: '' };

  for (const [re, rep] of DM_RULES) {
    word = word.replace(re, rep);
  }

  // Drop vowels (except a leading vowel) and collapse duplicate letters.
  const primary = word
    .split('')
    .filter((ch, i) => i === 0 || !'AEIOU'.includes(ch))
    .join('')
    .replace(/(.)\1+/g, '$1')
    .slice(0, 4);

  // Secondary key: keep vowels as a fallback sound-alike variant.
  const secondary = word
    .replace(/(.)\1+/g, '$1')
    .slice(0, 4);

  return { primary, secondary };
}

/**
 * Phonetic key for a full name: sorted phonetic tokens joined.
 * @param {string} name
 * @returns {string}
 */
export function phoneticKey(name) {
  return normalizeAndTokenizeName(name)
    .map((t) => doubleMetaphone(t).primary)
    .filter(Boolean)
    .sort()
    .join(' ');
}

// --- Damerau-Levenshtein --------------------------------------------------
/**
 * Damerau-Levenshtein edit distance (insert/delete/substitute/transpose).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function damerauLevenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }
  return d[m][n];
}

/**
 * Normalized similarity in [0,1] derived from Damerau-Levenshtein distance.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshteinSimilarity(a, b) {
  if (!a && !b) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - damerauLevenshtein(a, b) / max;
}

/**
 * Jaro-Winkler similarity in [0,1].
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function jaroWinkler(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Combined fuzzy similarity between two names using token-sorted
 * Damerau-Levenshtein and Jaro-Winkler, boosted by phonetic agreement.
 * @param {string} a
 * @param {string} b
 * @returns {number} similarity in [0,1]
 */
export function nameSimilarity(a, b) {
  const ta = normalizeAndTokenizeName(a).join(' ');
  const tb = normalizeAndTokenizeName(b).join(' ');
  if (!ta || !tb) return 0;
  const lev = levenshteinSimilarity(ta, tb);
  const jw = jaroWinkler(ta, tb);
  const phonetic = phoneticKey(a) === phoneticKey(b) ? 1 : 0;
  return Math.max(lev, jw, phonetic * 0.9);
}

/**
 * Map a similarity score to a confidence band.
 * @param {number} score
 * @returns {'High'|'Medium'|'Low'}
 */
export function matchConfidence(score) {
  if (score >= 0.95) return 'High';
  if (score >= FUZZY_THRESHOLD) return 'Medium';
  return 'Low';
}

/**
 * Fuzzy-match a name against a sanctions list, including aliases.
 * @param {string} name
 * @param {Array<{ name: string, aliases?: string[] }>} sanctionsList
 * @param {number} [threshold]
 * @returns {{ hit: boolean, match?: object, score?: number, confidence?: string, requiresReview?: boolean }}
 */
export function matchesSanctionsList(name, sanctionsList, threshold = FUZZY_THRESHOLD) {
  if (!name || !Array.isArray(sanctionsList)) return { hit: false };
  let best = null;
  for (const entry of sanctionsList) {
    const candidates = [entry?.name, ...(entry?.aliases ?? [])].filter(Boolean);
    for (const candidate of candidates) {
      const score = nameSimilarity(name, candidate);
      if (!best || score > best.score) {
        best = { entry, candidate, score };
      }
    }
  }
  if (!best || best.score < threshold) return { hit: false };
  const confidence = matchConfidence(best.score);
  return {
    hit: true,
    match: best.entry,
    matchedName: best.candidate,
    score: Number(best.score.toFixed(4)),
    confidence,
    requiresReview: confidence === 'High' || confidence === 'Medium',
  };
}

function httpPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, body: raw }); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function cacheKey(fullName, nationality) {
  return `${CACHE_PREFIX}${fullName.trim().toLowerCase()}|${(nationality ?? '').trim().toLowerCase()}`;
}

class SanctionsChecker {
  /**
   * Screen a person against sanctions lists.
   * @param {string} fullName
   * @param {string} [nationality]
   * @returns {Promise<{ hit: boolean, reason?: string, source?: string }>}
   */
  async check(fullName, nationality) {
    const key = cacheKey(fullName, nationality);
    try {
      const cached = await redis.get(key);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      sanctionsLogger.warn('sanctions.cache.read_failed', { error: err.message });
    }

    const result = await this._screen(fullName, nationality);

    try {
      await redis.set(key, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      sanctionsLogger.warn('sanctions.cache.write_failed', { error: err.message });
    }

    return result;
  }

  async _screen(fullName, nationality) {
    if (API_KEY) {
      return this._checkViaApi(fullName, nationality);
    }
    logger.error('sanctions.check.unconfigured', {
      message: 'SANCTIONS_API_KEY not set; screening cannot be performed',
      appEnv: APP_ENV,
      failMode: FAIL_MODE,
    });
    if (FAIL_MODE === 'closed') {
      return {
        hit: true,
        reason: 'Sanctions screening is not configured — blocking pending manual review',
        source: 'SCREENING_UNCONFIGURED',
        screeningError: true,
      };
    }
    // No API key — warn and return clear (operator must configure for production)
    sanctionsLogger.warn('SANCTIONS_API_KEY not set; screening skipped. Configure for production.');
    return { hit: false };
  }

  /**
   * Screen a crypto address against the locally synchronized SanctionsEntity
   * table (populated daily by sanctionsSync.js).
   * @param {string} address
   * @returns {Promise<{ hit: boolean, reason?: string, source?: string }>}
   */
  async checkCryptoAddress(address) {
    if (!address) return { hit: false };
    const normalized = address.trim().toLowerCase();
    try {
      const match = await prisma.sanctionsEntity.findFirst({
        where: { cryptoAddresses: { has: normalized } },
        select: { name: true, source: true },
      });
      if (match) {
        return {
          hit: true,
          reason: `Matched sanctioned crypto address: ${match.name}`,
          source: match.source ?? 'OFAC',
        };
      }
      return { hit: false };
    } catch (err) {
      logger.error('sanctions.crypto.lookup_failed', { error: err.message, appEnv: APP_ENV, failMode: FAIL_MODE });
      if (FAIL_MODE === 'closed') {
        return {
          hit: true,
          reason: `Sanctions database unavailable (${err.message}) — blocking pending manual review`,
          source: 'SCREENING_ERROR',
          screeningError: true,
        };
      }
      return { hit: false, warning: `Sanctions database unavailable: ${err.message}` };
    }
  }

  async _checkViaApi(fullName, nationality) {
    try {
      const payload = {
        apiKey: API_KEY,
        minScore: MIN_SCORE,
        sources: ['SDN', 'UN', 'EU'],
        cases: [{ name: fullName, ...(nationality ? { nationality } : {}) }],
      };
      const { status, body } = await httpPost(API_URL, payload, { apiKey: API_KEY });

      if (status !== 200) {
        logger.error('sanctions.api.error_status', { status, appEnv: APP_ENV, failMode: FAIL_MODE });
        if (FAIL_MODE === 'closed') {
          return {
            hit: true,
            reason: `Sanctions API returned ${status} — blocking pending manual review`,
            source: 'SCREENING_ERROR',
            screeningError: true,
          };
        }
        sanctionsLogger.error('API error', { status, body });
        // Fail open with a warning — operator should decide fail-closed policy
        return { hit: false, warning: `Sanctions API returned ${status}` };
      }

      const matches = body?.results?.[0]?.matches ?? [];
      if (matches.length > 0) {
        const top = matches[0];
        return {
          hit: true,
          reason: `Matched sanctions entry: ${top.name} (score: ${top.score}, lists: ${top.sources?.join(', ')})`,
          source: top.sources?.[0] ?? 'UNKNOWN',
        };
      }
      return { hit: false };
    } catch (err) {
      logger.error('sanctions.api.call_failed', { error: err.message, appEnv: APP_ENV, failMode: FAIL_MODE });
      if (FAIL_MODE === 'closed') {
        return {
          hit: true,
          reason: `Sanctions API unavailable (${err.message}) — blocking pending manual review`,
          source: 'SCREENING_ERROR',
          screeningError: true,
        };
      }
      sanctionsLogger.error('API call failed', { error: err.message });
      return { hit: false, warning: `Sanctions API unavailable: ${err.message}` };
    }
  }
}

export default new SanctionsChecker();
