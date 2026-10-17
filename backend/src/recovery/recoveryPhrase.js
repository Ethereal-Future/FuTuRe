import crypto from 'crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { BIP39_ENGLISH } from './bip39Wordlist.js';

// ── BIP-39 ───────────────────────────────────────────────────────────────────
// https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki

const WORD_INDEX = new Map(BIP39_ENGLISH.map((word, i) => [word, i]));
const VALID_WORD_COUNTS = [12, 15, 18, 21, 24];
const PBKDF2_ITERATIONS = 2048;
const SEED_LENGTH_BYTES = 64;

// SEP-0005: Stellar uses SLIP-0010 ed25519 derivation at m/44'/148'/x'
export const STELLAR_DERIVATION_PREFIX = "m/44'/148'";
const HARDENED_OFFSET = 0x80000000;
const SLIP10_ED25519_CURVE = Buffer.from('ed25519 seed', 'utf8');

function normalize(str) {
  return (str || '').normalize('NFKD');
}

function splitWords(mnemonic) {
  return normalize(mnemonic).trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function bytesToBits(bytes) {
  return [...bytes].map((b) => b.toString(2).padStart(8, '0')).join('');
}

function checksumBits(entropy) {
  const bits = entropy.length / 4; // ENT / 32
  return bytesToBits(crypto.createHash('sha256').update(entropy).digest()).slice(0, bits);
}

/**
 * Encode 128–256 bits of entropy as a BIP-39 mnemonic (English wordlist).
 * @param {Buffer} entropy - 16, 20, 24, 28 or 32 bytes
 * @returns {string}
 */
export function entropyToMnemonic(entropy) {
  if (
    !Buffer.isBuffer(entropy) ||
    entropy.length < 16 ||
    entropy.length > 32 ||
    entropy.length % 4 !== 0
  ) {
    throw new Error('Entropy must be 16-32 bytes and a multiple of 4');
  }
  const bits = bytesToBits(entropy) + checksumBits(entropy);
  const words = [];
  for (let i = 0; i < bits.length; i += 11) {
    words.push(BIP39_ENGLISH[parseInt(bits.slice(i, i + 11), 2)]);
  }
  return words.join(' ');
}

/**
 * Decode a mnemonic back to its entropy, verifying wordlist membership and
 * the embedded SHA-256 checksum.
 * @param {string} mnemonic
 * @returns {Buffer}
 */
export function mnemonicToEntropy(mnemonic) {
  const words = splitWords(mnemonic);
  if (!VALID_WORD_COUNTS.includes(words.length)) throw new Error('Invalid mnemonic length');

  const bits = words
    .map((word) => {
      const idx = WORD_INDEX.get(word);
      if (idx === undefined) {
        throw new Error('Mnemonic contains a word outside the BIP-39 wordlist');
      }
      return idx.toString(2).padStart(11, '0');
    })
    .join('');

  const dividerIndex = Math.floor(bits.length / 33) * 32;
  const entropyBits = bits.slice(0, dividerIndex);
  const checksum = bits.slice(dividerIndex);
  const entropy = Buffer.from(entropyBits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));

  if (checksumBits(entropy) !== checksum) throw new Error('Invalid mnemonic checksum');
  return entropy;
}

export function validateMnemonic(mnemonic) {
  try {
    mnemonicToEntropy(mnemonic);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a fresh BIP-39 mnemonic from CSPRNG entropy.
 * @param {number} [wordCount=12] - 12, 15, 18, 21 or 24
 */
export function generateRecoveryPhrase(wordCount = 12) {
  if (!VALID_WORD_COUNTS.includes(wordCount)) {
    throw new Error(`wordCount must be one of ${VALID_WORD_COUNTS.join(', ')}`);
  }
  const entropyBytes = (wordCount * 11 - wordCount / 3) / 8; // (MS * 11 - CS) / 8
  return entropyToMnemonic(crypto.randomBytes(entropyBytes));
}

/**
 * BIP-39 seed: PBKDF2-HMAC-SHA512, 2048 iterations, 64-byte output, with
 * salt "mnemonic" + passphrase. Both inputs are NFKD-normalized first.
 *
 * The mnemonic is used exactly as given (after normalization) — BIP-39 does
 * not require it to pass checksum validation to derive a seed.
 *
 * @param {string} mnemonic
 * @param {string} [passphrase='']
 * @returns {Buffer} 64-byte seed
 */
export function mnemonicToSeed(mnemonic, passphrase = '') {
  const password = Buffer.from(normalize(mnemonic), 'utf8');
  const salt = Buffer.from(`mnemonic${normalize(passphrase)}`, 'utf8');
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, SEED_LENGTH_BYTES, 'sha512');
}

// ── SLIP-0010 (ed25519) ──────────────────────────────────────────────────────
// https://github.com/satoshilabs/slips/blob/master/slip-0010.md
// ed25519 supports hardened derivation only.

function hmacSha512(key, data) {
  return crypto.createHmac('sha512', key).update(data).digest();
}

export function slip10MasterKey(seed) {
  const I = hmacSha512(SLIP10_ED25519_CURVE, seed);
  return { key: I.subarray(0, 32), chainCode: I.subarray(32) };
}

function ckdPrivHardened({ key, chainCode }, index) {
  const indexBuf = Buffer.alloc(4);
  indexBuf.writeUInt32BE(index >>> 0);
  const I = hmacSha512(chainCode, Buffer.concat([Buffer.alloc(1, 0), key, indexBuf]));
  return { key: I.subarray(0, 32), chainCode: I.subarray(32) };
}

/**
 * Derive a SLIP-0010 ed25519 node from a seed along a fully hardened path.
 * @param {Buffer} seed
 * @param {string} path - e.g. "m/44'/148'/0'"
 * @returns {{ key: Buffer, chainCode: Buffer }}
 */
export function derivePath(seed, path) {
  if (!/^m(\/\d+')*$/.test(path)) {
    throw new Error(
      "Invalid derivation path: ed25519 requires hardened segments, e.g. m/44'/148'/0'",
    );
  }
  return path
    .split('/')
    .slice(1)
    .map((segment) => {
      const index = parseInt(segment.slice(0, -1), 10);
      if (index >= HARDENED_OFFSET) throw new Error('Invalid derivation index');
      return index + HARDENED_OFFSET;
    })
    .reduce(ckdPrivHardened, slip10MasterKey(seed));
}

/**
 * SEP-0005 Stellar keypair from a BIP-39 mnemonic, compatible with ecosystem
 * wallets (Freighter, Albedo, Lobstr, Ledger) at m/44'/148'/{account}'.
 *
 * @param {string} mnemonic
 * @param {object} [opts]
 * @param {string} [opts.passphrase='']
 * @param {number} [opts.account=0]
 * @returns {Keypair}
 */
export function deriveStellarKeypair(mnemonic, { passphrase = '', account = 0 } = {}) {
  if (!Number.isInteger(account) || account < 0) {
    throw new Error('account must be a non-negative integer');
  }
  const seed = mnemonicToSeed(mnemonic, passphrase);
  const { key } = derivePath(seed, `${STELLAR_DERIVATION_PREFIX}/${account}'`);
  return Keypair.fromRawEd25519Seed(key);
}

// ── Storage helpers ──────────────────────────────────────────────────────────

export function hashPhrase(phrase) {
  return crypto.createHash('sha256').update(normalize(phrase).toLowerCase().trim()).digest('hex');
}

export function validatePhraseFormat(phrase) {
  const words = phrase.trim().split(/\s+/);
  return words.length >= 12 && words.every((w) => /^[a-z]+$/.test(w));
}
