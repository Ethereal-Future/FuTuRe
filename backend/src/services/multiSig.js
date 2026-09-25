import * as StellarSDK from '@stellar/stellar-sdk';
import { randomUUID } from 'crypto';
import { eventMonitor } from '../eventSourcing/index.js';
import { getConfig } from '../config/env.js';
import prisma from '../db/client.js';
import { getIssuer } from '../config/assets.js';
import logger from '../config/logger.js';
import { getHorizonServer, withHorizonRetry } from './stellar.js';
import { extractStellarErrorCode, getStellarErrorInfo } from '../utils/stellarErrors.js';
import { sendNotification } from '../notifications/service.js';
import { dispatchEvent } from '../webhooks/dispatcher.js';
import { validateThresholds } from './multiSigValidation.js';
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

export async function getAuthenticatedPublicKey(userId) {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { publicKey: true } });
  return user?.publicKey ?? null;
}

export async function isAuthorizedSigner(sourcePublicKey, callerPublicKey) {
  if (!sourcePublicKey || !callerPublicKey) return false;
  if (sourcePublicKey === callerPublicKey) return true;
  try {
    const account = await withHorizonRetry(() => getHorizonServer().loadAccount(sourcePublicKey));
    return account.signers.some((signer) => signer.key === callerPublicKey && signer.weight > 0);
  } catch {
    return false;
  }
}

function isValidStellarAddress(address) {
  try {
    return StellarSDK.StrKey.isValidEd25519PublicKey(address);
  } catch {
    return false;
  }
}

export async function authorizePendingTransaction(txId, callerPublicKey) {
  const pending = await prisma.pendingMultiSigTx.findUnique({ where: { txId } });
  if (!pending) return { pending: null, authorized: false };
  return {
    pending,
    authorized: await isAuthorizedSigner(pending.sourcePublicKey, callerPublicKey),
  };
}

export async function assertSourceSecretOwner(sourceSecret, callerPublicKey) {
  let sourcePublicKey;
  try {
    sourcePublicKey = StellarSDK.Keypair.fromSecret(sourceSecret).publicKey();
  } catch {
    throw new Error('Invalid source secret');
  }
  if (sourcePublicKey !== callerPublicKey)
    throw new Error('Authenticated user does not own the source account');
  return sourcePublicKey;
}

export async function assertSignerSecretOwner(signerSecret, callerPublicKey) {
  let signerPublicKey;
  try {
    signerPublicKey = StellarSDK.Keypair.fromSecret(signerSecret).publicKey();
  } catch {
    throw new Error('Invalid signer secret');
  }
  if (signerPublicKey !== callerPublicKey)
    throw new Error('Authenticated user does not own the signer secret');
  return signerPublicKey;
}

async function notifyRequiredSigners(sourcePublicKey, data, excludedPublicKeys = []) {
  try {
    const account = await withHorizonRetry(() => getHorizonServer().loadAccount(sourcePublicKey));
    const signerKeys = account.signers
      .filter((signer) => signer.weight > 0 && !excludedPublicKeys.includes(signer.key))
      .map((signer) => signer.key);
    if (!signerKeys.length) return;
    const users = await prisma.user.findMany({
      where: { publicKey: { in: signerKeys } },
      select: { id: true, publicKey: true },
    });
    await Promise.allSettled(
      users.flatMap((user) => [
        sendNotification({
          userId: user.id,
          type: 'multisig_signature_required',
          data,
          publicKey: user.publicKey,
        }),
        dispatchEvent(user.id, 'MultiSigSignatureRequired', data),
      ]),
    );
  } catch (error) {
    logger.warn('multiSig.notifyRequiredSigners.failed', { sourcePublicKey, error: error.message });
  }
}

function validationError(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'INVALID_MULTISIG_CONFIG';
  return err;
}

const DEFAULT_MULTISIG_TTL_SECONDS = 7 * 24 * 60 * 60;

function getMultiSigTtlSeconds() {
  const configured = Number(process.env.MULTISIG_TX_TTL_SECONDS);
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, 30 * 24 * 60 * 60) : DEFAULT_MULTISIG_TTL_SECONDS;
}

function conflictError(message, details = {}) {
  const error = new Error(message);
  error.status = 409;
  error.code = 'MULTISIG_CONFLICT';
  error.details = details;
  return error;
}

function sequenceDriftError(expected, actual) {
  const error = conflictError(`Sequence drift detected: pending transaction expects sequence ${expected}, but account is now at ${actual}. Collect fresh signatures before retrying.`, { expectedSequence: String(expected), actualSequence: String(actual) });
  error.code = 'MULTISIG_SEQUENCE_DRIFT';
  return error;
}

function getTransactionSequence(transaction) {
  return typeof transaction.sequenceNumber === 'function' ? BigInt(transaction.sequenceNumber()) : null;
}

function mergeStoredSignatures(transaction, records) {
  if (!Array.isArray(transaction.signatures)) return transaction;
  transaction.signatures.length = 0;
  for (const record of records) {
    transaction.signatures.push(StellarSDK.xdr.DecoratedSignature.fromXDR(record.signature, 'base64'));
  }
  return transaction;
}

function getRequiredThreshold(transaction, account) {
  if (!Array.isArray(transaction.operations)) return null;
  const requiresHigh = transaction.operations.some((operation) => {
    const type = operation.type || operation.body?.().switch?.()?.name;
    return type === 'setOptions' || type === 'accountMerge' || type === 'set_options' || type === 'account_merge';
  });
  const threshold = requiresHigh ? account.thresholds.high_threshold : account.thresholds.med_threshold;
  return Number(threshold ?? 0);
}

export function verifyThresholdsSatisfied(transaction, account) {
  const requiredWeight = getRequiredThreshold(transaction, account);
  if (requiredWeight === null) return { requiredWeight: null, totalWeight: null, remainingWeight: 0, validSigners: [] };
  const candidates = new Map();
  const masterWeight = Number(account.thresholds.master_key_weight ?? 0);
  if (masterWeight > 0) candidates.set(account.accountId || account.id || account.publicKey, masterWeight);
  for (const signer of account.signers || []) {
    if (signer.weight > 0) candidates.set(signer.key, Number(signer.weight));
  }
  const validSigners = verifyTransactionSignatures(transaction, [...candidates.keys()], { networkPassphrase: getNetworkPassphrase() }).map((entry) => entry.publicKey);
  const totalWeight = [...new Set(validSigners)].reduce((sum, key) => sum + (candidates.get(key) || 0), 0);
  if (totalWeight < requiredWeight) {
    const error = new Error(`InsufficientSignatures: Required weight ${requiredWeight}, but accumulated only ${totalWeight}`);
    error.status = 400;
    error.code = 'INSUFFICIENT_MULTISIG_WEIGHT';
    error.details = { requiredWeight, totalWeight, remainingWeight: requiredWeight - totalWeight, validSigners };
    throw error;
  }
  return { requiredWeight, totalWeight, remainingWeight: 0, validSigners };
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
  if (!Number.isInteger(masterWeight) || masterWeight < 0 || masterWeight > 255) {
    throw new Error('Master weight must be an integer between 0 and 255');
  }
  if (!Array.isArray(signers) || signers.length === 0)
    throw new Error('At least one signer is required');
  validateThresholds(
    thresholds,
    masterWeight + signers.reduce((total, signer) => total + signer.weight, 0),
  );
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
    logger.error('multiSig.createMultiSigAccount.failed', {
      publicKey: sourceKeypair.publicKey(),
      code,
      error: err.message,
    });
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
export async function buildMultiSigTransaction(sourcePublicKey, destination, amount, assetCode = 'XLM', options = {}) {
  const submissionSourcePublicKey = options.channelAccount || sourcePublicKey;
  const sourceAccount = await withHorizonRetry(() => getHorizonServer().loadAccount(submissionSourcePublicKey));
export async function buildMultiSigTransaction(
  sourcePublicKey,
  destination,
  amount,
  assetCode = 'XLM',
) {
  const sourceAccount = await withHorizonRetry(() =>
    getHorizonServer().loadAccount(sourcePublicKey),
  );

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
      }),
    )
    .setTimeout(options.ttlSeconds || getMultiSigTtlSeconds())
    .build();

  const txXdr = transaction.toXDR();
  const sourceSequence = getTransactionSequence(transaction);
  const txId = `multisig-${randomUUID()}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await prisma.pendingMultiSigTx.create({
    data: {
      txId,
      txXdr,
      baseTxXdr: txXdr,
      sourcePublicKey,
      submissionSourcePublicKey,
      ...(sourceSequence !== null && { sourceSequence }),
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
  await notifyRequiredSigners(sourcePublicKey, {
    txId,
    sourcePublicKey,
    destination,
    amount: amount.toString(),
    assetCode,
    reason: 'A multi-signature transaction is waiting for your signature.',
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
 * Add signature(s) to a pending multi-sig transaction from a client-signed
 * envelope. Private keys never enter the backend. Every signature on the
 * resulting envelope is cryptographically verified against the transaction
 * hash for the configured network before anything is persisted (#1288).
 * Prevents duplicate signatures.
 * @param {string} txId - The pending transaction ID returned by {@link buildMultiSigTransaction}
 * @param {{signedXdr: string, signerPublicKey?: string}} signer - Client-signed envelope,
 *   optionally with the expected signer public key
 * @returns {Promise<{txId: string, signerPublicKey: string, addedSigners: string[], totalSignatures: number, signatures: Array<{publicKey: string, signedAt: string}>, txXdr: string}>}
 * @throws {InvalidSignatureError} If any signature fails verification or the envelope doesn't match the pending transaction
 * @throws {Error} If the transaction is not found, is not pending, has expired, or if the signer already signed
 */
export async function addSignature(txId, { signedXdr, signerPublicKey: expectedSigner } = {}) {
  if (!signedXdr) throw validationError('signedXdr is required; sign the transaction on the client');

  const pending = await prisma.pendingMultiSigTx.findUnique({ where: { txId } });
  if (!pending) throw new Error(`Transaction ${txId} not found`);
  if (pending.status !== 'pending')
    throw new Error(`Transaction ${txId} is already ${pending.status}`);
  if (pending.expiresAt <= new Date()) throw new Error(`Transaction ${txId} has expired`);

  const networkPassphrase = getNetworkPassphrase();
  const signatures = Array.isArray(pending.signatures) ? pending.signatures : [];
  const recordedSigners = signatures.map((s) => s.publicKey);
  const pendingTx = parseTransactionXdr(pending.txXdr, networkPassphrase);

  const transaction = parseTransactionXdr(signedXdr, networkPassphrase);
  if (!Buffer.from(transaction.hash()).equals(Buffer.from(pendingTx.hash()))) {
    throw new InvalidSignatureError(
      `InvalidSignature: submitted envelope does not match pending transaction ${txId} (different transaction or network)`
    );
  }
  const candidates = [
    ...recordedSigners,
    ...(await loadAccountSignerKeys(pending.sourcePublicKey)),
    ...(expectedSigner ? [expectedSigner] : []),
  ];

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
  const newSignatureRecords = addedSigners.map((publicKey) => {
    const index = signerKeys.indexOf(publicKey);
    const decorated = transaction.signatures[index];
    return { txId, signerPublicKey: publicKey, signature: decorated?.toXDR ? decorated.toXDR('base64') : transaction.toXDR() };
  });
  if (prisma.multiSigSignature) {
    try {
      for (const record of newSignatureRecords) {
        await prisma.multiSigSignature.create({ data: record });
      }
    } catch (error) {
      if (error?.code === 'P2002') throw new Error(`Signer already signed transaction ${txId}`);
      throw error;
    }
  }

  // The signature table is the source of truth. Rebuild from all rows after
  // every insert so concurrent signers cannot replace one another's XDR.
  let compositeRecords = newSignatureRecords;
  if (prisma.multiSigSignature) {
    compositeRecords = await prisma.multiSigSignature.findMany({ where: { txId }, orderBy: { createdAt: 'asc' } });
  }
  const baseTransaction = parseTransactionXdr(pending.baseTxXdr || pending.txXdr, networkPassphrase);
  const updatedXdr = prisma.multiSigSignature
    ? mergeStoredSignatures(baseTransaction, compositeRecords).toXDR()
    : transaction.toXDR();
  const durableSignatures = compositeRecords.map((record) => ({ publicKey: record.signerPublicKey, signedAt: record.createdAt?.toISOString?.() || signedAt }));

  if (!prisma.multiSigSignature) {
    await prisma.pendingMultiSigTx.update({ where: { txId }, data: { txXdr: updatedXdr, signatures: durableSignatures } });
  } else {
    const { count } = await prisma.pendingMultiSigTx.updateMany({
      where: { txId, status: 'pending', txXdr: pending.txXdr },
      data: { txXdr: updatedXdr, signatures: durableSignatures },
    });
    if (count !== 1) {
      const latest = await prisma.pendingMultiSigTx.findUnique({ where: { txId } });
      throw conflictError(`Transaction ${txId} was modified concurrently, please retry signing`, { currentSignatures: latest?.signatures || durableSignatures });
    }
  }

  await eventMonitor.publishEvent(pending.sourcePublicKey, {
    type: 'MultiSigTransactionSigned',
    data: { txId, signerPublicKey: addedSigners[0], totalSignatures: updatedSignatures.length },
    version: 1,
  });
  await notifyRequiredSigners(
    pending.sourcePublicKey,
    {
      txId,
      sourcePublicKey: pending.sourcePublicKey,
      destination: pending.destination,
      amount: pending.amount,
      assetCode: pending.assetCode,
      signerPublicKey: addedSigners[0],
      reason: 'A new signature was added; your signature may still be required.',
    },
    addedSigners,
  );
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
  if (pending.status !== 'pending')
    throw new Error(`Transaction ${txId} is already ${pending.status}`);
  if (pending.expiresAt <= new Date()) throw new Error(`Transaction ${txId} has expired`);

  const transaction = StellarSDK.TransactionBuilder.fromXDR(pending.txXdr, getNetworkPassphrase());
  const submissionSource = pending.submissionSourcePublicKey || pending.sourcePublicKey;
  const currentAccount = prisma.multiSigSignature
    ? await withHorizonRetry(() => getHorizonServer().loadAccount(submissionSource))
    : null;
  if (currentAccount && pending.sourceSequence !== null && pending.sourceSequence !== undefined) {
    const currentSequence = BigInt(currentAccount.sequence);
    if (currentSequence !== BigInt(pending.sourceSequence)) {
      throw sequenceDriftError(pending.sourceSequence, currentSequence);
    }
  }
  if (currentAccount) verifyThresholdsSatisfied(transaction, { ...currentAccount, accountId: submissionSource });

  // Claim the row before touching Horizon. Only one request can transition a
  // pending transaction to submitting; losers receive a deterministic 409.
  if (prisma.multiSigSignature) {
    const claimed = await prisma.pendingMultiSigTx.updateMany({
      where: { txId, status: 'pending' },
      data: { status: 'submitting' },
    });
    if (claimed.count !== 1) throw conflictError(`Transaction ${txId} is already being submitted or executed`);
  }

  let result;
  try {
    result = await withHorizonRetry(() => getHorizonServer().submitTransaction(transaction));
  } catch (err) {
    if (prisma.multiSigSignature) await prisma.pendingMultiSigTx.updateMany({ where: { txId, status: 'submitting' }, data: { status: 'pending' } });
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
    sourceAccount = await withHorizonRetry(() =>
      getHorizonServer().loadAccount(sourceKeypair.publicKey()),
    );
  } catch (err) {
    const code = extractStellarErrorCode(err);
    const { userMessage } = getStellarErrorInfo(code);
    logger.error('multiSig.updateMultiSigConfig.loadAccount.failed', {
      publicKey: sourceKeypair.publicKey(),
      code,
      error: err.message,
    });
    const mapped = new Error(userMessage);
    mapped.code = code;
    mapped.original = err;
    throw mapped;
  }

  const removed = new Set(updates.removeSigners ?? []);
  const replacements = new Map(
    (updates.addSigners ?? []).map((signer) => [signer.publicKey, signer.weight]),
  );
  const signerWeight =
    sourceAccount.signers
      .filter((signer) => signer.key !== sourceKeypair.publicKey())
      .reduce((total, signer) => {
        if (removed.has(signer.key)) return total;
        return (
          total + (replacements.has(signer.key) ? replacements.get(signer.key) : signer.weight)
        );
      }, 0) +
    [...replacements.entries()]
      .filter(([publicKey]) => !sourceAccount.signers.some((signer) => signer.key === publicKey))
      .reduce((total, [, weight]) => total + weight, 0);
  const nextThresholds = {
    low: updates.thresholds?.low ?? sourceAccount.thresholds.low_threshold,
    medium: updates.thresholds?.medium ?? sourceAccount.thresholds.med_threshold,
    high: updates.thresholds?.high ?? sourceAccount.thresholds.high_threshold,
  };
  validateThresholds(
    nextThresholds,
    signerWeight + (updates.masterWeight ?? sourceAccount.thresholds.master_key_weight),
  );

  const txBuilder = new StellarSDK.TransactionBuilder(sourceAccount, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  });

  if (updates.thresholds || updates.masterWeight !== undefined) {
    txBuilder.addOperation(
      StellarSDK.Operation.setOptions({
        ...(updates.masterWeight !== undefined && { masterWeight: updates.masterWeight }),
        ...(updates.thresholds?.low !== undefined && { lowThreshold: updates.thresholds.low }),
        ...(updates.thresholds?.medium !== undefined && {
          medThreshold: updates.thresholds.medium,
        }),
        ...(updates.thresholds?.high !== undefined && { highThreshold: updates.thresholds.high }),
      }),
    );
  }
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
        }),
      );
    }
  }

  if (updates.removeSigners) {
    for (const publicKey of updates.removeSigners) {
      txBuilder.addOperation(
        StellarSDK.Operation.setOptions({
          signer: { ed25519PublicKey: publicKey, weight: 0 },
        }),
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
    logger.error('multiSig.updateMultiSigConfig.failed', {
      publicKey: sourceKeypair.publicKey(),
      code,
      error: err.message,
    });
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
    txId,
    destination,
    amount,
    assetCode,
    signatures,
    expiresAt,
    createdAt,
  }));
}
