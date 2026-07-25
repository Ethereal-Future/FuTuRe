import * as StellarSDK from '@stellar/stellar-sdk';
import { createAccount, mergeAccount, getBalance, isTestnet } from './stellar.js';
import { auditLogger } from '../security/index.js';
import { sendNotification } from '../notifications/service.js';
import prisma from '../db/client.js';
import logger from '../config/logger.js';

/**
 * Rotate the Stellar keypair for a clinic/user account.
 *
 * Workflow:
 *   1. Generate new keypair + fund via Friendbot (testnet) or platform account
 *   2. Transfer full XLM balance from old account to new via accountMerge
 *   3. Update DB record to point to new public key
 *   4. Emit KEYPAIR_ROTATE audit log
 *   5. Send email notification to clinic admin
 *
 * Atomicity guarantee: DB is only updated after the Stellar merge succeeds.
 * If the merge fails, the new (empty) account is abandoned — no DB change occurs.
 *
 * @param {object} opts
 * @param {string} opts.oldPublicKey   - Current account public key
 * @param {string} opts.oldSecretKey   - Current account secret key (needed to sign merge tx)
 * @param {string} opts.userId         - DB user id (for audit + notification)
 * @param {string} [opts.adminEmail]   - Email to notify on success
 * @param {string} [opts.correlationId]
 * @returns {{ newPublicKey: string, newSecretKey: string, mergeHash: string }}
 */
export async function rotateKeypair({ oldPublicKey, oldSecretKey, userId, adminEmail, correlationId }) {
  logger.info('keypairRotation.start', { oldPublicKey, userId, correlationId });

  // Step 1: Generate and fund new account
  let newPublicKey, newSecretKey;
  try {
    const newAccount = await createAccount(correlationId);
    newPublicKey = newAccount.publicKey;
    newSecretKey = newAccount.secretKey;
    logger.info('keypairRotation.newAccountCreated', { newPublicKey, correlationId });
  } catch (err) {
    logger.error('keypairRotation.newAccountCreation.failed', { error: err.message, correlationId });
    throw new Error(`Failed to create new account: ${err.message}`);
  }

  // Step 2: Transfer balance via accountMerge (sends all XLM, closes old account)
  let mergeResult;
  try {
    mergeResult = await mergeAccount(oldSecretKey, newPublicKey);
    logger.info('keypairRotation.merge.success', { oldPublicKey, newPublicKey, hash: mergeResult.hash, correlationId });
  } catch (err) {
    // Merge failed — new account was created but is empty; old account unchanged.
    // Log the orphaned account for manual cleanup, but don't update DB.
    logger.error('keypairRotation.merge.failed', {
      oldPublicKey, newPublicKey, error: err.message, correlationId,
      note: 'New account is orphaned and can be reclaimed',
    });
    throw new Error(`Balance transfer failed — rotation rolled back: ${err.message}`);
  }

  // Step 3: Update DB — only reached if merge succeeded
  try {
    await prisma.$transaction(async (tx) => {
      // Update the user's public key
      await tx.user.update({
        where: { publicKey: oldPublicKey },
        data: { publicKey: newPublicKey },
      });
      // Migrate settings to new public key reference (settings are linked by userId, not publicKey, so no change needed)
    });
    logger.info('keypairRotation.db.updated', { oldPublicKey, newPublicKey, correlationId });
  } catch (err) {
    // DB update failed after successful Stellar merge — critical inconsistency
    logger.error('keypairRotation.db.failed', {
      oldPublicKey, newPublicKey, mergeHash: mergeResult.hash, error: err.message, correlationId,
      note: 'CRITICAL: Stellar merge succeeded but DB not updated. Manual intervention required.',
    });
    throw new Error(`DB update failed after successful balance transfer. New key: ${newPublicKey}, merge tx: ${mergeResult.hash}`);
  }

  // Step 4: Audit log
  try {
    await auditLogger.logSecurityEvent('KEYPAIR_ROTATE', userId, {
      oldPublicKey,
      newPublicKey,
      mergeHash: mergeResult.hash,
      correlationId,
    });
  } catch (err) {
    logger.warn('keypairRotation.audit.failed', { error: err.message, correlationId });
    // Non-fatal — rotation already succeeded
  }

  // Step 5: Email notification
  if (adminEmail) {
    try {
      await sendNotification({
        userId,
        type: 'keypair_rotated',
        data: { oldPublicKey, newPublicKey, mergeHash: mergeResult.hash },
        email: adminEmail,
        channels: ['email'],
      });
    } catch (err) {
      logger.warn('keypairRotation.notification.failed', { error: err.message, correlationId });
      // Non-fatal
    }
  }

  logger.info('keypairRotation.complete', { oldPublicKey, newPublicKey, correlationId });

  return {
    newPublicKey,
    newSecretKey,
    mergeHash: mergeResult.hash,
  };
}
