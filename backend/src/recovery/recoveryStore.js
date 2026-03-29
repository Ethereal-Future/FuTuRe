// In-memory recovery phrase store (replace with DB in production)
// Stores hashed phrases only — never plaintext
const userPhrases = new Map(); // userId -> { phraseHash, createdAt, usedAt }

// In-memory recovery data store for new credentials post-recovery
const pendingCredentials = new Map(); // userId -> { passwordHash, expiresAt }

import { hashPhrase, generateRecoveryPhrase, validatePhraseFormat } from './recoveryPhrase.js';
import { hashPassword } from '../auth/password.js';
import { getUserById } from '../auth/userStore.js';

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
