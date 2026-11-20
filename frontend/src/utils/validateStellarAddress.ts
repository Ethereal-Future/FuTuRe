import { StrKey } from '@stellar/stellar-base';

/**
 * True for a standard ed25519 account (G...) or a SEP-0023 muxed account (M...).
 */
export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address) || StrKey.isValidMed25519PublicKey(address);
}

/** True when `address` is a valid SEP-0023 muxed account (M...), which embeds a memo ID. */
export function isMuxedAddress(address: string): boolean {
  return typeof address === 'string' && StrKey.isValidMed25519PublicKey(address.trim());
}

// user*domain.tld — local part may not contain '*' or whitespace.
const FEDERATION_ADDRESS = /^[^*\s]+\*(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const BASE32_CHARS = /^[A-Z2-7]+$/;
const PUBLIC_KEY_LENGTH = 56;
const MUXED_KEY_LENGTH = 69;

export function isFederationAddress(address: string): boolean {
  return FEDERATION_ADDRESS.test(address);
}

export type StellarAddressError =
  | 'empty'
  | 'secretKey'
  | 'federationFormat'
  | 'prefix'
  | 'invalidChars'
  | 'length'
  | 'muxedLength'
  | 'checksum';

/**
 * Explain why `address` is not a usable recipient.
 * Accepts ed25519 public keys (G...), SEP-0023 muxed accounts (M...), both
 * with CRC16 checksum, and federation addresses.
 * Returns null when valid.
 */
export function getStellarAddressError(rawAddress: string): StellarAddressError | null {
  const address = rawAddress.trim();
  if (!address) return 'empty';
  if (address.includes('*')) return isFederationAddress(address) ? null : 'federationFormat';
  if (address.startsWith('S') && StrKey.isValidEd25519SecretSeed(address)) return 'secretKey';
  if (address.startsWith('M')) {
    if (!BASE32_CHARS.test(address)) return 'invalidChars';
    if (address.length !== MUXED_KEY_LENGTH) return 'muxedLength';
    if (!StrKey.isValidMed25519PublicKey(address)) return 'checksum';
    return null;
  }
  if (!address.startsWith('G')) return 'prefix';
  if (!BASE32_CHARS.test(address)) return 'invalidChars';
  if (address.length !== PUBLIC_KEY_LENGTH) return 'length';
  if (!StrKey.isValidEd25519PublicKey(address)) return 'checksum';
  return null;
}

/** Indexes of characters outside the base32 alphabet, for highlighting. */
export function findInvalidAddressChars(address: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < address.length; i++) {
    if (!/[A-Z2-7]/.test(address[i])) out.push(i);
  }
  return out;
}
