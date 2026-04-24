import * as StellarSDK from '@stellar/stellar-sdk';
import dotenv from 'dotenv';
import { eventMonitor } from '../eventSourcing/index.js';
import prisma from '../db/client.js';
import { getIssuer } from '../config/assets.js';
import { getHorizonServer } from './stellar.js';

dotenv.config();

const isTestnet = process.env.STELLAR_NETWORK === 'testnet';
const networkPassphrase = isTestnet ? StellarSDK.Networks.TESTNET : StellarSDK.Networks.PUBLIC;

/**
 * Create a multi-signature account by setting signers and threshold on an existing account.
 * @param {string} sourceSecret - Secret key of the account to convert to multi-sig
 * @param {Array<{publicKey: string, weight: number}>} signers - Additional signers to add
 * @param {object} thresholds - { low, medium, high } threshold weights
 * @param {number} masterWeight - Weight for the master key (0 to remove)
 */
export async function createMultiSigAccount(sourceSecret, signers, thresholds, masterWeight = 1) {
  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourceAccount = await getHorizonServer().loadAccount(sourceKeypair.publicKey());
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
 * Build a multi-sig transaction (XDR) without submitting — signers collect signatures separately.
 */
export async function buildMultiSigTransaction(sourcePublicKey, destination, amount, assetCode = 'XLM') {
  const sourceAccount = await getHorizonServer().loadAccount(sourcePublicKey);

  const asset =
    assetCode === 'XLM'
      ? StellarSDK.Asset.native()
      : new StellarSDK.Asset(assetCode, getIssuer(assetCode));

  const transaction = new StellarSDK.TransactionBuilder(sourceAccount, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase,
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
 * Add a signature to a pending multi-sig transaction.
 */
export async function addSignature(txId, signerSecret) {
  const pending = await prisma.pendingMultiSigTx.findUnique({ where: { txId } });
  if (!pending) throw new Error(`Transaction ${txId} not found`);
  if (pending.status !== 'pending') throw new Error(`Transaction ${txId} is already ${pending.status}`);

  const signerKeypair = StellarSDK.Keypair.fromSecret(signerSecret);
  const signerPublicKey = signerKeypair.publicKey();

  const signatures = pending.signatures;
  // Prevent duplicate signatures
  if (signatures.some((s) => s.publicKey === signerPublicKey)) {
    throw new Error(`Signer ${signerPublicKey} has already signed this transaction`);
  }

  const transaction = StellarSDK.TransactionBuilder.fromXDR(pending.txXdr, networkPassphrase);
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
 * Submit a fully-signed multi-sig transaction to the network.
 */
export async function submitMultiSigTransaction(txId) {
  const pending = await prisma.pendingMultiSigTx.findUnique({ where: { txId } });
  if (!pending) throw new Error(`Transaction ${txId} not found`);
  if (pending.status !== 'pending') throw new Error(`Transaction ${txId} is already ${pending.status}`);

  const transaction = StellarSDK.TransactionBuilder.fromXDR(pending.txXdr, networkPassphrase);
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
 * Verify that a transaction XDR has valid signatures from the expected signers.
 */
export function verifySignatures(txXdr, expectedSigners) {
  const transaction = StellarSDK.TransactionBuilder.fromXDR(txXdr, networkPassphrase);
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
 * Get the current signers and thresholds for an account from the network.
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
 * Update signers or thresholds on an existing multi-sig account.
 */
export async function updateMultiSigConfig(sourceSecret, updates) {
  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourceAccount = await getHorizonServer().loadAccount(sourceKeypair.publicKey());

  const txBuilder = new StellarSDK.TransactionBuilder(sourceAccount, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase,
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
 * Get all pending multi-sig transactions for a given source account.
 */
export async function getPendingTransactions(sourcePublicKey) {
  const rows = await prisma.pendingMultiSigTx.findMany({ where: { sourcePublicKey } });
  return rows.map(({ txId, destination, amount, assetCode, signatures, status, createdAt }) => ({
    txId, destination, amount, assetCode, signatures, status, createdAt,
  }));
}

/**
 * Get a specific pending transaction by ID.
 */
export async function getPendingTransaction(txId) {
  return prisma.pendingMultiSigTx.findUnique({ where: { txId } });
}
