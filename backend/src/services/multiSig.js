import * as StellarSDK from '@stellar/stellar-sdk';
import { randomUUID } from 'crypto';
import { eventMonitor } from '../eventSourcing/index.js';
import { getConfig } from '../config/env.js';
import prisma from '../db/client.js';
import { getIssuer } from '../config/assets.js';
import logger from '../config/logger.js';
import { getHorizonServer, withHorizonRetry } from './stellar.js';
import { extractStellarErrorCode, getStellarErrorInfo } from '../utils/stellarErrors.js';
import {
  InvalidSignatureError,
  parseTransactionXdr,
  verifyTransactionSignatures,
} from '../utils/cryptoVerification.js';
import { invalidateBalanceCache } from '../cache/balanceCache.js';

function isTestnet() {
  return getConfig().stellar.network === 'testnet';
}

function getNetworkPassphrase() {
  return isTestnet() ? StellarSDK.Networks.TESTNET : StellarSDK.Networks.PUBLIC;
}

function isValidStellarAddress(address) {
  try {
    return StellarSDK.StrKey.isValidEd25519PublicKey(address);
  } catch {
    return false;
  }
}

function validationError(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'INVALID_MULTISIG_CONFIG';
  return err;
}

/**
 * Guard against converting an account into a state where it can no longer
 * sign (#1289). Revoking the master key (masterWeight 0) is only allowed when
 * at least two valid alternative signers are added in the same transaction and
 * their combined weight can meet the high threshold on their own.
 * @param {string} sourcePublicKey
 * @param {Array<{publicKey: string, weight: number}>} signers
 * @param {{low: number, medium: number, high: number}} thresholds
 * @param {number} masterWeight
 */
export function validateMultiSigConversion(sourcePublicKey, signers, thresholds, masterWeight) {
  if (!Array.isArray(signers) || signers.length === 0) {
    throw validationError('At least one signer is required');
  }

  const seen = new Set();
  for (const signer of signers) {
    if (!isValidStellarAddress(signer?.publicKey)) {
      throw validationError(`Invalid signer public key: ${signer?.publicKey}`);
    }
    if (signer.publicKey === sourcePublicKey) {
      throw validationError('The master key cannot be added as an additional signer; use masterWeight');
    }
    if (seen.has(signer.publicKey)) {
      throw validationError(`Duplicate signer: ${signer.publicKey}`);
    }
    seen.add(signer.publicKey);
    if (!Number.isInteger(signer.weight) || signer.weight < 1 || signer.weight > 255) {
      throw validationError(`Signer ${signer.publicKey} weight must be an integer 1-255`);
    }
  }

  const { low, medium, high } = thresholds || {};
  for (const [name, value] of Object.entries({ low, medium, high })) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw validationError(`Threshold ${name} must be an integer 0-255`);
    }
  }
  if (!Number.isInteger(masterWeight) || masterWeight < 0 || masterWeight > 255) {
    throw validationError('masterWeight must be an integer 0-255');
  }

  const totalSignerWeight = signers.reduce((sum, s) => sum + s.weight, 0);
  if (masterWeight === 0) {
    if (signers.length < 2) {
      throw validationError('masterWeight can only be set to 0 when at least two alternative signers are added');
    }
    if (totalSignerWeight < high) {
      throw validationError(
        `masterWeight can only be set to 0 when the added signers' total weight (${totalSignerWeight}) meets the high threshold (${high})`
      );
    }
  }

  // Whatever the master weight, the resulting signer set must be able to reach
  // every threshold or the account is permanently locked for those operations.
  const reachable = totalSignerWeight + masterWeight;
  if (reachable < Math.max(low, medium, high)) {
    throw validationError(
      `Combined signer weight (${reachable}) is below the highest threshold (${Math.max(low, medium, high)}); the account would be locked`
    );
  }
}

/**
 * Build the ordered setOptions operations for a multi-sig conversion.
 * Signers are added first, thresholds second, and the master weight
 * (including revocation) is always the final operation (#1289).
 * @returns {Array<StellarSDK.xdr.Operation>}
 */
export function buildMultiSigConversionOperations(signers, thresholds, masterWeight) {
  const operations = signers.map((signer) =>
    StellarSDK.Operation.setOptions({
      signer: {
        ed25519PublicKey: signer.publicKey,
        weight: signer.weight,
      },
    })
  );

  operations.push(
    StellarSDK.Operation.setOptions({
      lowThreshold: thresholds.low,
      medThreshold: thresholds.medium,
      highThreshold: thresholds.high,
    })
  );

  operations.push(StellarSDK.Operation.setOptions({ masterWeight }));
  return operations;
}

/**
 * Convert an existing account to multi-signature by setting signers and operation thresholds.
 * @param {string} sourceSecret - Secret key of the account to convert to multi-sig
 * @param {Array<{publicKey: string, weight: number}>} signers - Additional signers to add
 * @param {{low: number, medium: number, high: number}} thresholds - Operation threshold weights
 * @param {number} [masterWeight=1] - Weight for the master key (set to 0 to remove master key)
 * @returns {Promise<{publicKey: string, signers: Array<{publicKey: string, weight: number}>, thresholds: object, masterWeight: number, hash: string, success: boolean}>}
 * @throws {Error} If the signer/threshold configuration could lock the account, or Horizon submission fails
 */
export async function createMultiSigAccount(sourceSecret, signers, thresholds, masterWeight = 1) {
  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  validateMultiSigConversion(sourceKeypair.publicKey(), signers, thresholds, masterWeight);

  const sourceAccount = await withHorizonRetry(() => getHorizonServer().loadAccount(sourceKeypair.publicKey()));
  const txBuilder = new StellarSDK.TransactionBuilder(sourceAccount, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  });

  // Signers first, thresholds second, master weight last — so the master key
  // is never revoked before its replacements exist in the account.
  for (const operation of buildMultiSigConversionOperations(signers, thresholds, masterWeight)) {
    txBuilder.addOperation(operation);
  }

  const transaction = txBuilder.setTimeout(30).build();
  transaction.sign(sourceKeypair);
  let result;
  try {
    result = await withHorizonRetry(() => getHorizonServer().submitTransaction(transaction));
  } catch (err) {
    const code = extractStellarErrorCode(err);
    const { userMessage } = getStellarErrorInfo(code);
    logger.error('multiSig.createMultiSigAccount.failed', { publicKey: sourceKeypair.publicKey(), code, error: err.message });
    const mapped = new Error(userMessage);
    mapped.code = code;
    mapped.original = err;
    throw mapped;
  }

  await eventMonitor.publishEvent(sourceKeypair.publicKey(), {
    type: 'MultiSigAccountCreated',
    data: {
      publicKey: sourceKeypair.publicKey(),
      signers,
      thresholds,
      masterWeight,
      hash: result.hash,
    },
    version: 1,
  });

  return {
    publicKey: sourceKeypair.publicKey(),
    signers,
    thresholds,
    masterWeight,
    hash: result.hash,
    success: result.successful,
  };
}

/**
 * Build a multi-sig payment transaction as XDR without submitting it, persisting it as pending
 * so multiple signers can add their signatures before submission. Expires in 5 minutes.
 * @param {string} sourcePublicKey - Stellar public key of the source account
 * @param {string} destination - Stellar public key of the recipient
 * @param {string|number} amount - Amount to send (in asset units)
 * @param {string} [assetCode='XLM'] - Asset code (e.g. 'XLM', 'USDC')
 * @returns {Promise<{txId: string, txXdr: string}>} Unique transaction ID and base64-encoded XDR
 * @throws {Error} If the asset issuer is unknown or Horizon account load fails
 * @example
 * const { txId, txXdr } = await buildMultiSigTransaction('GSRC...', 'GDST...', '100', 'USDC');
 */
export async function buildMultiSigTransaction(sourcePublicKey, destination, amount, assetCode = 'XLM') {
  const sourceAccount = await withHorizonRetry(() => getHorizonServer().loadAccount(sourcePublicKey));

  const asset =
    assetCode === 'XLM'
      ? StellarSDK.Asset.native()
      : new StellarSDK.Asset(assetCode, getIssuer(assetCode));

  const transaction = new StellarSDK.TransactionBuilder(sourceAccount, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(
      StellarSDK.Operation.payment({
        destination,
        asset,
        amount: amount.toString(),
      })
    )
    .setTimeout(300)
    .build();

  const txXdr = transaction.toXDR();
  const txId = `multisig-${randomUUID()}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await prisma.pendingMultiSigTx.create({
    data: {
      txId,
      txXdr,
      sourcePublicKey,
      destination,
      amount: amount.toString(),
      assetCode,
      signatures: [],
      status: 'pending',
      expiresAt,
    },
  });

  await eventMonitor.publishEvent(sourcePublicKey, {
    type: 'MultiSigTransactionBuilt',
    data: { txId, destination, amount, assetCode },
    version: 1,
  });

  return { txId, txXdr };
}

async function loadAccountSignerKeys(publicKey) {
  try {
    const account = await withHorizonRetry(() => getHorizonServer().loadAccount(publicKey));
    return account.signers
      .filter((s) => s.weight > 0 && s.type === 'ed25519_public_key')
      .map((s) => s.key);
  } catch (err) {
    logger.warn('multiSig.loadAccountSigners.failed', { publicKey, error: err.message });
    return [];
  }
}

/**
 * Add signature(s) to a pending multi-sig transaction. Accepts either a signer
 * secret (the server signs) or a client-signed envelope. Every signature on
 * the resulting envelope is cryptographically verified against the
 * transaction hash for the configured network before anything is persisted
 * (#1288). Prevents duplicate signatures.
 * @param {string} txId - The pending transaction ID returned by {@link buildMultiSigTransaction}
 * @param {string|{signerSecret?: string, signedXdr?: string, signerPublicKey?: string}} signer -
 *   A signer secret key, or an object with either `signerSecret` or a client-signed `signedXdr`
 *   (optionally with the expected `signerPublicKey`)
 * @returns {Promise<{txId: string, signerPublicKey: string, addedSigners: string[], totalSignatures: number, signatures: Array<{publicKey: string, signedAt: string}>, txXdr: string}>}
 * @throws {InvalidSignatureError} If any signature fails verification or the envelope doesn't match the pending transaction
 * @throws {Error} If the transaction is not found, is not pending, has expired, or if the signer already signed
 */
export async function addSignature(txId, signer) {
  const { signerSecret, signedXdr, signerPublicKey: expectedSigner } =
    typeof signer === 'string' ? { signerSecret: signer } : (signer || {});
  if (!signerSecret && !signedXdr) throw validationError('signerSecret or signedXdr is required');

  const pending = await prisma.pendingMultiSigTx.findUnique({ where: { txId } });
  if (!pending) throw new Error(`Transaction ${txId} not found`);
  if (pending.status !== 'pending') throw new Error(`Transaction ${txId} is already ${pending.status}`);
  if (pending.expiresAt <= new Date()) throw new Error(`Transaction ${txId} has expired`);

  const networkPassphrase = getNetworkPassphrase();
  const signatures = Array.isArray(pending.signatures) ? pending.signatures : [];
  const recordedSigners = signatures.map((s) => s.publicKey);
  const pendingTx = parseTransactionXdr(pending.txXdr, networkPassphrase);

  let transaction;
  let candidates;
  if (signerSecret) {
    const signerKeypair = StellarSDK.Keypair.fromSecret(signerSecret);
    const signerPublicKey = signerKeypair.publicKey();
    if (recordedSigners.includes(signerPublicKey)) {
      throw new Error(`Signer ${signerPublicKey} has already signed this transaction`);
    }
    transaction = pendingTx;
    transaction.sign(signerKeypair);
    candidates = [...recordedSigners, signerPublicKey];
  } else {
    transaction = parseTransactionXdr(signedXdr, networkPassphrase);
    if (!Buffer.from(transaction.hash()).equals(Buffer.from(pendingTx.hash()))) {
      throw new InvalidSignatureError(
        `InvalidSignature: submitted envelope does not match pending transaction ${txId} (different transaction or network)`
      );
    }
    candidates = [
      ...recordedSigners,
      ...(await loadAccountSignerKeys(pending.sourcePublicKey)),
      ...(expectedSigner ? [expectedSigner] : []),
    ];
  }

  const verified = verifyTransactionSignatures(transaction, candidates, { networkPassphrase });
  const signerKeys = verified.map((v) => v.publicKey);

  if (new Set(signerKeys).size !== signerKeys.length) {
    throw new InvalidSignatureError('InvalidSignature: envelope contains duplicate signatures from the same signer');
  }
  const dropped = recordedSigners.filter((pk) => !signerKeys.includes(pk));
  if (dropped.length > 0) {
    throw new InvalidSignatureError(
      `InvalidSignature: envelope is missing previously collected signature(s) from ${dropped.join(', ')}`
    );
  }

  const addedSigners = signerKeys.filter((pk) => !recordedSigners.includes(pk));
  if (addedSigners.length === 0) {
    throw new Error(`Submitted envelope for ${txId} contains no new signatures`);
  }
  if (expectedSigner && !addedSigners.includes(expectedSigner)) {
    throw new InvalidSignatureError(
      `InvalidSignature: Signature verification failed for signer ${expectedSigner} (no valid signature from this signer)`
    );
  }

  const signedAt = new Date().toISOString();
  const updatedSignatures = [...signatures, ...addedSigners.map((publicKey) => ({ publicKey, signedAt }))];
  const updatedXdr = transaction.toXDR();

  // Compare-and-swap on the envelope so two concurrent signers can't
  // overwrite each other's signature.
  const { count } = await prisma.pendingMultiSigTx.updateMany({
    where: { txId, status: 'pending', txXdr: pending.txXdr },
    data: { txXdr: updatedXdr, signatures: updatedSignatures },
  });
  if (count !== 1) {
    throw new Error(`Transaction ${txId} was modified concurrently, please retry signing`);
  }

  for (const publicKey of addedSigners) {
    await eventMonitor.publishEvent(pending.sourcePublicKey, {
      type: 'MultiSigTransactionSigned',
      data: { txId, signerPublicKey: publicKey, totalSignatures: updatedSignatures.length },
      version: 1,
    });
  }

  return {
    txId,
    signerPublicKey: addedSigners[0],
    addedSigners,
    totalSignatures: updatedSignatures.length,
    signatures: updatedSignatures,
    txXdr: updatedXdr,
  };
}

/**
 * Submit a fully-signed multi-sig transaction to the Stellar network.
 * @param {string} txId - The pending transaction ID returned by {@link buildMultiSigTransaction}
 * @returns {Promise<{txId: string, hash: string, ledger: number, success: boolean, signatures: object[]}>}
 * @throws {Error} If the transaction is not found, not in pending status, has expired, or if Horizon rejects it
 */
export async function submitMultiSigTransaction(txId) {
  const pending = await prisma.pendingMultiSigTx.findUnique({ where: { txId } });
  if (!pending) throw new Error(`Transaction ${txId} not found`);
  if (pending.status !== 'pending') throw new Error(`Transaction ${txId} is already ${pending.status}`);
  if (pending.expiresAt <= new Date()) throw new Error(`Transaction ${txId} has expired`);

  const transaction = StellarSDK.TransactionBuilder.fromXDR(pending.txXdr, getNetworkPassphrase());
  let result;
  try {
    result = await withHorizonRetry(() => getHorizonServer().submitTransaction(transaction));
  } catch (err) {
    const code = extractStellarErrorCode(err);
    const { userMessage } = getStellarErrorInfo(code);
    logger.error('multiSig.submitMultiSigTransaction.failed', { txId, code, error: err.message });
    const mapped = new Error(userMessage);
    mapped.code = code;
    mapped.original = err;
    throw mapped;
  }

  await prisma.pendingMultiSigTx.update({
    where: { txId },
    data: { status: result.successful ? 'submitted' : 'failed' },
  });

  if (pending.destination) {
    await Promise.all([
      invalidateBalanceCache(pending.sourcePublicKey),
      invalidateBalanceCache(pending.destination),
    ]);
    try {
      const { broadcastToAccount } = await import('./websocket.js');
      broadcastToAccount(pending.destination, {
        type: 'balance_update',
        action: 'multisig_payment_received',
        source: pending.sourcePublicKey,
        destination: pending.destination,
        amount: pending.amount,
        assetCode: pending.assetCode || 'XLM',
        hash: result.hash,
      });
    } catch (wsErr) {
      logger.warn('multiSig.submit.wsNotification.failed', { destination: pending.destination, error: wsErr.message });
    }
  } else {
    await invalidateBalanceCache(pending.sourcePublicKey);
  }

  await eventMonitor.publishEvent(pending.sourcePublicKey, {
    type: 'MultiSigTransactionSubmitted',
    data: {
      txId,
      hash: result.hash,
      signatures: pending.signatures,
      destination: pending.destination,
      amount: pending.amount,
    },
    version: 1,
  });

  return {
    txId,
    hash: result.hash,
    ledger: result.ledger,
    success: result.successful,
    signatures: pending.signatures,
  };
}

/**
 * Verify that a transaction XDR has valid signatures from all expected signers.
 * @param {string} txXdr - Base64-encoded XDR of the signed transaction
 * @param {string[]} expectedSigners - List of Stellar public keys that must have signed
 * @returns {{allValid: boolean, results: Array<{publicKey: string, valid: boolean}>}}
 */
export function verifySignatures(txXdr, expectedSigners) {
  const transaction = StellarSDK.TransactionBuilder.fromXDR(txXdr, getNetworkPassphrase());
  const txHash = transaction.hash();

  const results = expectedSigners.map((publicKey) => {
    const keypair = StellarSDK.Keypair.fromPublicKey(publicKey);
    const sig = transaction.signatures.find((s) => {
      try {
        return keypair.verify(txHash, s.signature());
      } catch {
        return false;
      }
    });
    return { publicKey, valid: !!sig };
  });

  return {
    allValid: results.every((r) => r.valid),
    results,
  };
}

/**
 * Fetch the current signers and operation thresholds for an account from Horizon.
 * @param {string} publicKey - Stellar public key of the account
 * @returns {Promise<{publicKey: string, signers: Array<{publicKey: string, weight: number, type: string}>, thresholds: {low: number, medium: number, high: number}, masterWeight: number}>}
 * @throws {Error} If the account does not exist on the network
 */
export async function getMultiSigConfig(publicKey) {
  let account;
  try {
    account = await withHorizonRetry(() => getHorizonServer().loadAccount(publicKey));
  } catch (err) {
    const code = extractStellarErrorCode(err);
    const { userMessage } = getStellarErrorInfo(code);
    logger.error('multiSig.getMultiSigConfig.failed', { publicKey, code, error: err.message });
    const mapped = new Error(userMessage);
    mapped.code = code;
    mapped.original = err;
    throw mapped;
  }

  const signers = account.signers.map((s) => ({
    publicKey: s.key,
    weight: s.weight,
    type: s.type,
  }));

  return {
    publicKey,
    signers,
    thresholds: {
      low: account.thresholds.low_threshold,
      medium: account.thresholds.med_threshold,
      high: account.thresholds.high_threshold,
    },
    masterWeight: account.thresholds.master_key_weight,
  };
}

/**
 * Update signers or thresholds on an existing multi-sig account in a single transaction.
 * @param {string} sourceSecret - Secret key of the multi-sig account (must satisfy current thresholds)
 * @param {object} updates
 * @param {{low?: number, medium?: number, high?: number}} [updates.thresholds] - New threshold values
 * @param {number} [updates.masterWeight] - New master key weight
 * @param {Array<{publicKey: string, weight: number}>} [updates.addSigners] - Signers to add or update
 * @param {string[]} [updates.removeSigners] - Public keys of signers to remove (weight set to 0)
 * @returns {Promise<{hash: string, success: boolean}>}
 * @throws {Error} If the transaction fails authorization or Horizon rejects it
 */
export async function updateMultiSigConfig(sourceSecret, updates) {
  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  let sourceAccount;
  try {
    sourceAccount = await withHorizonRetry(() => getHorizonServer().loadAccount(sourceKeypair.publicKey()));
  } catch (err) {
    const code = extractStellarErrorCode(err);
    const { userMessage } = getStellarErrorInfo(code);
    logger.error('multiSig.updateMultiSigConfig.loadAccount.failed', { publicKey: sourceKeypair.publicKey(), code, error: err.message });
    const mapped = new Error(userMessage);
    mapped.code = code;
    mapped.original = err;
    throw mapped;
  }

  const txBuilder = new StellarSDK.TransactionBuilder(sourceAccount, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  });

  for (const signer of updates.addSigners || []) {
    if (!isValidStellarAddress(signer?.publicKey)) {
      throw validationError(`Invalid signer public key: ${signer?.publicKey}`);
    }
  }
  for (const publicKey of updates.removeSigners || []) {
    if (!isValidStellarAddress(publicKey)) {
      throw validationError(`Invalid signer public key: ${publicKey}`);
    }
  }

  // Same safe ordering as createMultiSigAccount (#1289): signer changes first,
  // thresholds next, master weight last.
  if (updates.addSigners) {
    for (const signer of updates.addSigners) {
      txBuilder.addOperation(
        StellarSDK.Operation.setOptions({
          signer: { ed25519PublicKey: signer.publicKey, weight: signer.weight },
        })
      );
    }
  }

  if (updates.removeSigners) {
    for (const publicKey of updates.removeSigners) {
      txBuilder.addOperation(
        StellarSDK.Operation.setOptions({
          signer: { ed25519PublicKey: publicKey, weight: 0 },
        })
      );
    }
  }

  if (updates.thresholds) {
    txBuilder.addOperation(
      StellarSDK.Operation.setOptions({
        ...(updates.thresholds.low !== undefined && { lowThreshold: updates.thresholds.low }),
        ...(updates.thresholds.medium !== undefined && { medThreshold: updates.thresholds.medium }),
        ...(updates.thresholds.high !== undefined && { highThreshold: updates.thresholds.high }),
      })
    );
  }

  if (updates.masterWeight !== undefined) {
    txBuilder.addOperation(StellarSDK.Operation.setOptions({ masterWeight: updates.masterWeight }));
  }

  const transaction = txBuilder.setTimeout(30).build();
  transaction.sign(sourceKeypair);
  let result;
  try {
    result = await withHorizonRetry(() => getHorizonServer().submitTransaction(transaction));
  } catch (err) {
    const code = extractStellarErrorCode(err);
    const { userMessage } = getStellarErrorInfo(code);
    logger.error('multiSig.updateMultiSigConfig.failed', { publicKey: sourceKeypair.publicKey(), code, error: err.message });
    const mapped = new Error(userMessage);
    mapped.code = code;
    mapped.original = err;
    throw mapped;
  }

  await eventMonitor.publishEvent(sourceKeypair.publicKey(), {
    type: 'MultiSigConfigUpdated',
    data: { publicKey: sourceKeypair.publicKey(), updates, hash: result.hash },
    version: 1,
  });

  return { hash: result.hash, success: result.successful };
}

/**
 * List active (pending and not yet expired) multi-sig transactions initiated by a given account.
 * @param {string} sourcePublicKey - Stellar public key of the initiating account
 * @returns {Promise<Array<{txId: string, destination: string, amount: string, assetCode: string, signatures: object[], status: string, expiresAt: Date, createdAt: Date}>>}
 */
export async function getPendingTransactions(sourcePublicKey) {
  const rows = await prisma.pendingMultiSigTx.findMany({
    where: { sourcePublicKey, status: 'pending', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(({ txId, destination, amount, assetCode, signatures, status, expiresAt, createdAt }) => ({
    txId, destination, amount, assetCode, signatures, status, expiresAt, createdAt,
  }));
}

/**
 * Fetch a single pending multi-sig transaction by its unique ID.
 * @param {string} txId - The pending transaction ID
 * @returns {Promise<import('@prisma/client').PendingMultiSigTx|null>} The record, or null if not found
 */
export async function getPendingTransaction(txId) {
  const tx = await prisma.pendingMultiSigTx.findUnique({ where: { txId } });
  // Between scheduler runs a row can be past expiry but still 'pending'.
  if (tx && tx.status === 'pending' && tx.expiresAt <= new Date()) {
    return { ...tx, status: 'expired' };
  }
  return tx;
}

/**
 * Mark all pending multi-sig transactions that have passed their expiry as 'expired',
 * and notify all signers via WebSocket broadcast.
 * Intended to be called by a scheduled cleanup job.
 * @returns {Promise<number>} The count of records updated
 */
export async function expireStaleTransactions() {
  // Fetch records before updating so we can notify signers
  const stale = await prisma.pendingMultiSigTx.findMany({
    where: { status: 'pending', expiresAt: { lte: new Date() } },
  });

  if (stale.length === 0) return 0;

  const txIds = stale.map((tx) => tx.txId);
  const { count } = await prisma.pendingMultiSigTx.updateMany({
    // Re-check status/expiry so a row submitted in the meantime isn't clobbered.
    where: { txId: { in: txIds }, status: 'pending', expiresAt: { lte: new Date() } },
    data: { status: 'expired' },
  });

  // Notify the source account for each expired transaction
  const { broadcastToAccount } = await import('./websocket.js');
  for (const tx of stale) {
    broadcastToAccount(tx.sourcePublicKey, {
      type: 'multisig_tx_expired',
      txId: tx.txId,
      destination: tx.destination,
      amount: tx.amount,
      assetCode: tx.assetCode,
    });

    await eventMonitor.publishEvent(tx.sourcePublicKey, {
      type: 'MultiSigTransactionExpired',
      data: { txId: tx.txId, signers: tx.signatures },
      version: 1,
    });
  }

  return count;
}

/**
 * Scheduled cleanup for abandoned multi-sig transactions (#1287): transitions
 * every pending row whose expiresAt has passed to status 'expired' (relies on
 * the (status, expiresAt) index) and notifies the source accounts.
 * @returns {Promise<number>} The count of records transitioned to 'expired'
 */
export async function cleanupExpiredMultiSigTransactions() {
  return expireStaleTransactions();
}

/**
 * List all expired multi-sig transactions, optionally filtered by source account.
 * @param {string} [sourcePublicKey] - Optional filter by source account
 * @returns {Promise<Array>}
 */
export async function getExpiredTransactions(sourcePublicKey) {
  const where = { status: 'expired' };
  if (sourcePublicKey) where.sourcePublicKey = sourcePublicKey;
  const rows = await prisma.pendingMultiSigTx.findMany({ where });
  return rows.map(({ txId, destination, amount, assetCode, signatures, expiresAt, createdAt }) => ({
    txId, destination, amount, assetCode, signatures, expiresAt, createdAt,
  }));
}
