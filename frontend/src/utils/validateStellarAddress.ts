import { StrKey } from '@stellar/stellar-base';

export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address);
}
