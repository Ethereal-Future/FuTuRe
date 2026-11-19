// In-memory recovery phrase store (replace with DB in production)
// Stores hashed phrases only — never plaintext
const userPhrases = new Map(); // userId -> { phraseHash, createdAt, usedAt }

// In-memory recovery data store for new credentials post-recovery
const pendingCredentials = new Map(); // userId -> { passwordHash, expiresAt }

// In-memory share registry for Shamir's Secret Sharing
// userId -> { threshold: number, totalShares: number, collectedShares: string[] }
const shareRegistry = new Map();

import { hashPhrase, generateRecoveryPhrase, validatePhraseFormat } from './recoveryPhrase.js';
import { hashPassword } from '../auth/password.js';
import logger from '../config/logger.js';

// ── Recovery phrase ──────────────────────────────────────────────────────────

export function setupRecoveryPhrase(userId) {
  const phrase = generateRecoveryPhrase(12);
  userPhrases.set(userId, {
    phraseHash: hashPhrase(phrase),
    createdAt: new Date().toISOString(),
    usedAt: null,
  });
  // Return plaintext ONCE — caller must show to user and never store it
  return phrase;
}

export function verifyRecoveryPhrase(userId, phrase) {
  if (!validatePhraseFormat(phrase)) return false;
  const stored = userPhrases.get(userId);
  if (!stored) return false;
  return stored.phraseHash === hashPhrase(phrase);
}

export function markPhraseUsed(userId) {
  const stored = userPhrases.get(userId);
  if (stored) stored.usedAt = new Date().toISOString();
}

export function hasRecoveryPhrase(userId) {
  return userPhrases.has(userId);
}

// ── Shamir's Secret Sharing — threshold-gated reconstruction ─────────────────

/**
 * Register the M-of-N share configuration for a user.
 * Must be called when the secret is first split so the threshold is stored
 * authoritatively on the server side — never supplied by the collector at
 * reconstruction time.
 *
 * @param {string} userId
 * @param {number} threshold  Minimum shares required to reconstruct (M)
 * @param {number} totalShares Total shares distributed (N)
 */
export function registerShareConfig(userId, threshold, totalShares) {
  if (!Number.isInteger(threshold) || threshold < 2) {
    throw new Error('Threshold must be an integer >= 2');
  }
  if (!Number.isInteger(totalShares) || totalShares < threshold) {
    throw new Error('totalShares must be >= threshold');
  }
  shareRegistry.set(userId, {
    threshold,
    totalShares,
    collectedShares: [],
  });
  logger.info({ userId, threshold, totalShares }, 'Share configuration registered');
}

/**
 * Submit one share during a recovery attempt.
 * Shares are accumulated server-side; reconstruction is only attempted once
 * the registered threshold is reached.
 *
 * @param {string} userId
 * @param {string} share  A single Shamir share (hex or base64 encoded)
 * @returns {{ thresholdReached: boolean, collectedCount: number, threshold: number }}
 */
export function submitShare(userId, share) {
  if (!share || typeof share !== 'string' || share.trim() === '') {
    throw new Error('Share must be a non-empty string');
  }

  const config = shareRegistry.get(userId);
  if (!config) {
    throw new Error(
      'No share configuration found for this user. Call registerShareConfig first.',
    );
  }

  // Prevent duplicate share submission
  if (config.collectedShares.includes(share)) {
    throw new Error('This share has already been submitted');
  }

  // Enforce upper bound — never accumulate beyond total distributed shares
  if (config.collectedShares.length >= config.totalShares) {
    throw new Error('All shares have already been submitted');
  }

  config.collectedShares.push(share);
  logger.info(
    { userId, collectedCount: config.collectedShares.length, threshold: config.threshold },
    'Recovery share submitted',
  );

  return {
    thresholdReached: config.collectedShares.length >= config.threshold,
    collectedCount: config.collectedShares.length,
    threshold: config.threshold,
  };
}

/**
 * Reconstruct the master secret from accumulated shares.
 *
 * THRESHOLD GATE: Reconstruction is refused unless the number of collected
 * shares meets or exceeds the registered threshold.  The threshold is always
 * read from the server-side registry — callers cannot override it.
 *
 * @param {string} userId
 * @param {Function} reconstructFn  The SSS library's combine/reconstruct function,
 *   injected so this module stays library-agnostic (e.g. `secrets.combine` from
 *   the `secrets.js` package, or an equivalent).
 * @returns {string}  The reconstructed plaintext secret
 */
export function reconstructSecret(userId, reconstructFn) {
  const config = shareRegistry.get(userId);

  if (!config) {
    throw new Error(
      'No share configuration found for this user. Call registerShareConfig first.',
    );
  }

  // ── Threshold gate ──────────────────────────────────────────────────────
  if (config.collectedShares.length < config.threshold) {
    throw new Error(
      `Threshold not met: ${config.collectedShares.length} of ${config.threshold} ` +
      `required shares have been provided. Reconstruction refused.`,
    );
  }

  if (typeof reconstructFn !== 'function') {
    throw new Error('reconstructFn must be a callable SSS combine function');
  }

  logger.info(
    { userId, shares: config.collectedShares.length, threshold: config.threshold },
    'Threshold met — reconstructing master secret',
  );

  // Pass only the required number of shares to the SSS library
  const sharesToUse = config.collectedShares.slice(0, config.threshold);
  const secret = reconstructFn(sharesToUse);

  // Invalidate the collected shares immediately after use to prevent replay
  config.collectedShares = [];
  logger.info({ userId }, 'Shares cleared after successful reconstruction');

  return secret;
}

/**
 * Clear any in-progress share collection for a user (e.g. on session expiry
 * or recovery cancellation).
 */
export function clearShares(userId) {
  const config = shareRegistry.get(userId);
  if (config) {
    config.collectedShares = [];
    logger.info({ userId }, 'Pending shares cleared');
  }
}

/**
 * Return the current share collection status without exposing the shares
 * themselves.
 */
export function getShareStatus(userId) {
  const config = shareRegistry.get(userId);
  if (!config) return null;
  return {
    threshold: config.threshold,
    totalShares: config.totalShares,
    collectedCount: config.collectedShares.length,
    thresholdReached: config.collectedShares.length >= config.threshold,
  };
}

// ── Staged credentials ───────────────────────────────────────────────────────

export async function stageNewCredentials(userId, newPassword) {
  const hash = await hashPassword(newPassword);
  pendingCredentials.set(userId, {
    passwordHash: hash,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  });
}

export function consumePendingCredentials(userId) {
  const creds = pendingCredentials.get(userId);
  if (!creds) return null;
  if (new Date() > new Date(creds.expiresAt)) {
    pendingCredentials.delete(userId);
    return null;
  }
  pendingCredentials.delete(userId);
  return creds;
}
