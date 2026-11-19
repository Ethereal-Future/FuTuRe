import crypto from 'crypto';
import WORDLIST from './bip39English.js';

// BIP-39: 11 bits per word from a 2048-word list, with SHA-256 checksum bits.
const VALID_WORD_COUNTS = [12, 15, 18, 21, 24];
const WORD_INDEX = new Map(WORDLIST.map((w, i) => [w, i]));

function bytesToBits(bytes) {
  return Array.from(bytes, b => b.toString(2).padStart(8, '0')).join('');
}

function checksumBits(entropy) {
  const cs = (entropy.length * 8) / 32;
  return bytesToBits(crypto.createHash('sha256').update(entropy).digest()).slice(0, cs);
}

export function entropyToMnemonic(entropy) {
  if (entropy.length < 16 || entropy.length > 32 || entropy.length % 4 !== 0) {
    throw new Error('Invalid entropy length');
  }
  const bits = bytesToBits(entropy) + checksumBits(entropy);
  const words = [];
  for (let i = 0; i < bits.length; i += 11) {
    words.push(WORDLIST[parseInt(bits.slice(i, i + 11), 2)]);
  }
  return words.join(' ');
}

export function generateRecoveryPhrase(wordCount = 12) {
  if (!VALID_WORD_COUNTS.includes(wordCount)) {
    throw new Error(`wordCount must be one of ${VALID_WORD_COUNTS.join(', ')}`);
  }
  return entropyToMnemonic(crypto.randomBytes((wordCount * 11 * 32) / 33 / 8));
}

export function hashPhrase(phrase) {
  return crypto.createHash('sha256').update(phrase.toLowerCase().trim()).digest('hex');
}

export function validateMnemonic(phrase) {
  const words = phrase.trim().toLowerCase().split(/\s+/);
  if (!VALID_WORD_COUNTS.includes(words.length)) return false;
  let bits = '';
  for (const w of words) {
    const idx = WORD_INDEX.get(w);
    if (idx === undefined) return false;
    bits += idx.toString(2).padStart(11, '0');
  }
  const entBits = (words.length * 11 * 32) / 33;
  const entropy = Buffer.from(bits.slice(0, entBits).match(/.{8}/g).map(b => parseInt(b, 2)));
  return checksumBits(entropy) === bits.slice(entBits);
}

export function validatePhraseFormat(phrase) {
  return validateMnemonic(phrase);
}
