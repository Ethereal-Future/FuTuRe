import { StrKey } from '@stellar/stellar-base';

export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address);
}

// user*domain.tld — local part may not contain '*' or whitespace.
const FEDERATION_ADDRESS = /^[^*\s]+\*(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const BASE32_CHARS = /^[A-Z2-7]+$/;
const PUBLIC_KEY_LENGTH = 56;

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
  | 'checksum';

/**
 * Explain why `address` is not a usable recipient.
 * Accepts ed25519 public keys (with CRC16 checksum) and federation addresses.
 * Returns null when valid.
 */
export function getStellarAddressError(rawAddress: string): StellarAddressError | null {
  const address = rawAddress.trim();
  if (!address) return 'empty';
  if (address.includes('*')) return isFederationAddress(address) ? null : 'federationFormat';
  if (address.startsWith('S') && StrKey.isValidEd25519SecretSeed(address)) return 'secretKey';
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
