import * as StellarSDK from '@stellar/stellar-sdk';

// Cryptographic verification of signatures attached to Stellar transaction
// envelopes (#1288). Every signature is checked against the transaction hash
// for the configured network passphrase before it is persisted, so a garbage
// signature, one made for a different transaction, or one made for another
// network (e.g. Testnet → Mainnet) is rejected at submission time instead of
// surfacing later as an opaque `tx_bad_auth` from Horizon.

const KNOWN_NETWORKS = Object.values(StellarSDK.Networks);

export class InvalidSignatureError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'InvalidSignatureError';
    this.status = 400;
    this.code = 'InvalidSignature';
    this.details = details;
  }
}

function safeVerify(keypair, data, signature) {
  try {
    return keypair.verify(data, signature);
  } catch {
    return false;
  }
}

function hashForNetwork(transaction, networkPassphrase) {
  try {
    const rebuilt = StellarSDK.TransactionBuilder.fromXDR(transaction.toXDR(), networkPassphrase);
    return rebuilt.hash();
  } catch {
    return null;
  }
}

/**
 * Parse a base64 transaction envelope for the given network, converting parse
 * failures into InvalidSignatureError so malformed envelopes are a 400.
 * @param {string} xdr
 * @param {string} networkPassphrase
 * @returns {StellarSDK.Transaction|StellarSDK.FeeBumpTransaction}
 */
export function parseTransactionXdr(xdr, networkPassphrase) {
  try {
    return StellarSDK.TransactionBuilder.fromXDR(xdr, networkPassphrase);
  } catch (err) {
    throw new InvalidSignatureError(`Malformed transaction envelope: ${err.message}`);
  }
}

/**
 * Detect whether `signature` by `keypair` is valid for this transaction on a
 * network other than `networkPassphrase`.
 * @returns {string|null} The passphrase it was signed for, or null
 */
function findSigningNetwork(transaction, keypair, signature, networkPassphrase) {
  for (const passphrase of KNOWN_NETWORKS) {
    if (passphrase === networkPassphrase) continue;
    const hash = hashForNetwork(transaction, passphrase);
    if (hash && safeVerify(keypair, hash, signature)) return passphrase;
  }
  return null;
}

/**
 * Verify every signature attached to a transaction against its hash and a set
 * of candidate signer public keys.
 *
 * Signatures are matched to candidates by their 4-byte hint and then verified
 * with ed25519. Any signature that doesn't verify against a candidate — bad
 * bytes, wrong transaction, wrong network, or an unknown signer — causes an
 * InvalidSignatureError naming the offending signer.
 *
 * @param {StellarSDK.Transaction|StellarSDK.FeeBumpTransaction} transaction - Parsed transaction
 * @param {string[]} candidatePublicKeys - Public keys allowed to sign this transaction
 * @param {object} opts
 * @param {string} opts.networkPassphrase - Configured network passphrase
 * @returns {Array<{publicKey: string, index: number}>} The signer of each attached signature, in order
 * @throws {InvalidSignatureError} If any signature fails verification
 */
export function verifyTransactionSignatures(transaction, candidatePublicKeys, { networkPassphrase }) {
  if (transaction.networkPassphrase && transaction.networkPassphrase !== networkPassphrase) {
    throw new InvalidSignatureError(
      'InvalidSignature: transaction network passphrase does not match the configured STELLAR_NETWORK',
      { expected: networkPassphrase, actual: transaction.networkPassphrase }
    );
  }

  const txHash = transaction.hash();
  const candidates = [...new Set(candidatePublicKeys)]
    .filter((pk) => StellarSDK.StrKey.isValidEd25519PublicKey(pk))
    .map((pk) => StellarSDK.Keypair.fromPublicKey(pk));

  return transaction.signatures.map((decorated, index) => {
    let hint;
    let signature;
    try {
      hint = decorated.hint();
      signature = decorated.signature();
    } catch {
      throw new InvalidSignatureError(`InvalidSignature: signature #${index} is malformed`, { index });
    }

    const hinted = candidates.filter((kp) => Buffer.from(kp.signatureHint()).equals(Buffer.from(hint)));
    const match = hinted.find((kp) => safeVerify(kp, txHash, signature));
    if (match) return { publicKey: match.publicKey(), index };

    const hintHex = Buffer.from(hint).toString('hex');
    if (hinted.length === 0) {
      throw new InvalidSignatureError(
        `InvalidSignature: signature #${index} (hint ${hintHex}) does not belong to any authorized signer`,
        { index, hint: hintHex }
      );
    }

    // Hint matched a known signer but the bytes don't verify — explain why.
    const signer = hinted[0];
    const otherNetwork = findSigningNetwork(transaction, signer, signature, networkPassphrase);
    const reason = otherNetwork
      ? `signed for a different network ("${otherNetwork}")`
      : 'signature does not match the transaction hash';
    throw new InvalidSignatureError(
      `InvalidSignature: Signature verification failed for signer ${signer.publicKey()} (${reason})`,
      { index, publicKey: signer.publicKey(), hint: hintHex, networkMismatch: Boolean(otherNetwork) }
    );
  });
}
