import * as StellarSDK from '@stellar/stellar-sdk';
import { eventMonitor } from '../eventSourcing/index.js';
import { getConfig } from '../config/env.js';
import prisma from '../db/client.js';
import { getIssuer } from '../config/assets.js';
import { getHorizonServer } from './stellar.js';

function isTestnet() {
  return getConfig().stellar.network === 'testnet';
}

function getNetworkPassphrase() {
  return isTestnet() ? StellarSDK.Networks.TESTNET : StellarSDK.Networks.PUBLIC;
}

/**
 * Convert an existing account to multi-signature by setting signers and operation thresholds.
 * @param {string} sourceSecret - Secret key of the account to convert to multi-sig
 * @param {Array<{publicKey: string, weight: number}>} signers - Additional signers to add
 * @param {{low: number, medium: number, high: number}} thresholds - Operation threshold weights
 * @param {number} [masterWeight=1] - Weight for the master key (set to 0 to remove master key)
 * @returns {Promise<{publicKey: string, signers: Array<{publicKey: string, weight: number}>, thresholds: object, masterWeight: number, hash: string, success: boolean}>}
 * @throws {Error} If Horizon submission fails
 */
export async function createMultiSigAccount(sourceSecret, signers, thresholds, masterWeight = 1) {
  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourceAccount = await getHorizonServer().loadAccount(sourceKeypair.publicKey());
  const txBuilder = new StellarSDK.TransactionBuilder(sourceAccount, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  });
  txBuilder.addOperation(
    StellarSDK.Operation.setOptions({
      masterWeight,
      lowThreshold: thresholds.low,
      medThreshold: thresholds.medium,
      highThreshold: thresholds.high,
    })
  );

  // Add each signer
  for (const signer of signers) {
    txBuilder.addOperation(
      StellarSDK.Operation.setOptions({
        signer: {
          ed25519PublicKey: signer.publicKey,
          weight: signer.weight,
        },
      })
    );
  }

  const transaction = txBuilder.setTimeout(30).build();
  transaction.sign(sourceKeypair);
  const result = await getHorizonServer().submitTransaction(transaction);

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
  const sourceAccount = await getHorizonServer().loadAccount(sourcePublicKey);

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
  const txId = `multisig-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
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

/**
 * Add a signer's signature to a pending multi-sig transaction. Prevents duplicate signatures.
 * @param {string} txId - The pending transaction ID returned by {@link buildMultiSigTransaction}
 * @param {string} signerSecret - Secret key of the signer
 * @returns {Promise<{txId: string, signerPublicKey: string, totalSignatures: number, signatures: Array<{publicKey: string, signedAt: string}>, txXdr: string}>}
 * @throws {Error} If the transaction is not found, is not pending, has expired, or if the signer already signed
 */
export async function addSignature(txId, signerSecret) {
  const pending = await prisma.pendingMultiSigTx.findUnique({ where: { txId } });
  if (!pending) throw new Error(`Transaction ${txId} not found`);
  if (pending.status !== 'pending') throw new Error(`Transaction ${txId} is already ${pending.status}`);
  if (pending.expiresAt <= new Date()) throw new Error(`Transaction ${txId} has expired`);

  const signerKeypair = StellarSDK.Keypair.fromSecret(signerSecret);
  const signerPublicKey = signerKeypair.publicKey();

  const signatures = pending.signatures;
  // Prevent duplicate signatures
  if (signatures.some((s) => s.publicKey === signerPublicKey)) {
    throw new Error(`Signer ${signerPublicKey} has already signed this transaction`);
  }

  const transaction = StellarSDK.TransactionBuilder.fromXDR(pending.txXdr, getNetworkPassphrase());
  transaction.sign(signerKeypair);

  const updatedSignatures = [...signatures, { publicKey: signerPublicKey, signedAt: new Date().toISOString() }];
  const updatedXdr = transaction.toXDR();

  await prisma.pendingMultiSigTx.update({
    where: { txId },
    data: { txXdr: updatedXdr, signatures: updatedSignatures },
  });

  await eventMonitor.publishEvent(pending.sourcePublicKey, {
    type: 'MultiSigTransactionSigned',
    data: { txId, signerPublicKey, totalSignatures: updatedSignatures.length },
    version: 1,
  });

  return {
    txId,
    signerPublicKey,
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
  const result = await getHorizonServer().submitTransaction(transaction);

  await prisma.pendingMultiSigTx.update({
    where: { txId },
    data: { status: result.successful ? 'submitted' : 'failed' },
  });

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
  const account = await getHorizonServer().loadAccount(publicKey);

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
  const sourceAccount = await getHorizonServer().loadAccount(sourceKeypair.publicKey());

  const txBuilder = new StellarSDK.TransactionBuilder(sourceAccount, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  });

  if (updates.thresholds || updates.masterWeight !== undefined) {
    txBuilder.addOperation(
      StellarSDK.Operation.setOptions({
        ...(updates.masterWeight !== undefined && { masterWeight: updates.masterWeight }),
        ...(updates.thresholds?.low !== undefined && { lowThreshold: updates.thresholds.low }),
        ...(updates.thresholds?.medium !== undefined && { medThreshold: updates.thresholds.medium }),
        ...(updates.thresholds?.high !== undefined && { highThreshold: updates.thresholds.high }),
      })
    );
  }

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

  const transaction = txBuilder.setTimeout(30).build();
  transaction.sign(sourceKeypair);
  const result = await getHorizonServer().submitTransaction(transaction);

  await eventMonitor.publishEvent(sourceKeypair.publicKey(), {
    type: 'MultiSigConfigUpdated',
    data: { publicKey: sourceKeypair.publicKey(), updates, hash: result.hash },
    version: 1,
  });

  return { hash: result.hash, success: result.successful };
}

/**
 * List all pending multi-sig transactions initiated by a given account.
 * @param {string} sourcePublicKey - Stellar public key of the initiating account
 * @returns {Promise<Array<{txId: string, destination: string, amount: string, assetCode: string, signatures: object[], status: string, createdAt: Date}>>}
 */
export async function getPendingTransactions(sourcePublicKey) {
  const rows = await prisma.pendingMultiSigTx.findMany({ where: { sourcePublicKey } });
  return rows.map(({ txId, destination, amount, assetCode, signatures, status, createdAt }) => ({
    txId, destination, amount, assetCode, signatures, status, createdAt,
  }));
}

/**
 * Fetch a single pending multi-sig transaction by its unique ID.
 * @param {string} txId - The pending transaction ID
 * @returns {Promise<import('@prisma/client').PendingMultiSigTx|null>} The record, or null if not found
 */
export async function getPendingTransaction(txId) {
  return prisma.pendingMultiSigTx.findUnique({ where: { txId } });
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
    where: { txId: { in: txIds } },
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
