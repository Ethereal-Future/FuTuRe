import { StrKey } from '@stellar/stellar-sdk';

export function isValidStellarAddress(address) {
  return typeof address === 'string' && StrKey.isValidEd25519PublicKey(address);
}
