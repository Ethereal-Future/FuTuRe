import * as StellarSDK from '@stellar/stellar-sdk';
import { createAccount, mergeAccount, getBalance, getTrustlines, getOpenOffers, isTestnet } from './stellar.js';
import { auditLogger } from '../security/index.js';
import { sendNotification } from '../notifications/service.js';
import prisma from '../db/client.js';
import logger from '../config/logger.js';

/**
 * Thrown when a keypair rotation cannot proceed because the source account
 * still holds state (trustlines/offers) that Stellar's `accountMerge`
 * operation rejects. No new account is created when this is thrown.
 */
export class KeypairRotationBlockedError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'KeypairRotationBlockedError';
    this.details = details;
  }
}

/**
 * Verify that an account is eligible for `accountMerge`: it must hold no
 * non-native trustlines with a non-zero balance and no open DEX offers,
 * both of which cause Horizon to reject the merge operation outright.
 *
 * @param {string} publicKey - Account to check
 * @throws {KeypairRotationBlockedError} If any blocking trustlines or offers are found
 */
async function assertMergeable(publicKey) {
  const [trustlines, offers] = await Promise.all([
    getTrustlines(publicKey),
    getOpenOffers(publicKey),
  ]);

  const nonZeroTrustlines = trustlines.filter((t) => parseFloat(t.balance) > 0);

  if (nonZeroTrustlines.length > 0 || offers.length > 0) {
    throw new KeypairRotationBlockedError(
      'Account cannot be merged: clear non-zero trustlines and open offers before rotating keys',
      {
        trustlines: nonZeroTrustlines.map((t) => ({ assetCode: t.assetCode, issuer: t.issuer, balance: t.balance })),
        openOfferCount: offers.length,
      },
    );
  }
}

/**
 * Rotate the Stellar keypair for a clinic/user account.
 *
 * Workflow:
 *   0. Verify the old account holds no trustlines/offers that would block the merge
 *   1. Generate new keypair + fund via Friendbot (testnet) or platform account
 *   2. Transfer full XLM balance from old account to new via accountMerge
 *   3. Update DB record to point to new public key
 *   4. Emit KEYPAIR_ROTATE audit log
 *   5. Send email notification to clinic admin
 *
 * Atomicity guarantee: DB is only updated after the Stellar merge succeeds.
 * If the merge fails, the new (empty) account is abandoned — no DB change occurs.
 *
 * Precondition: the old account must hold only XLM — no non-zero trustlines
 * and no open DEX offers — since Stellar's `accountMerge` operation rejects
 * source accounts with sub-entries. This is checked up front so rotation
 * fails fast without ever creating a new account.
 *
 * @param {object} opts
 * @param {string} opts.oldPublicKey   - Current account public key
 * @param {string} opts.oldSecretKey   - Current account secret key (needed to sign merge tx)
 * @param {string} opts.userId         - DB user id (for audit + notification)
 * @param {string} [opts.adminEmail]   - Email to notify on success
 * @param {string} [opts.correlationId]
 * @returns {{ newPublicKey: string, newSecretKey: string, mergeHash: string }}
 * @throws {KeypairRotationBlockedError} If the old account has non-zero trustlines or open offers
 */
export async function rotateKeypair({ oldPublicKey, oldSecretKey, userId, adminEmail, correlationId }) {
  logger.info('keypairRotation.start', { oldPublicKey, userId, correlationId });

  // Step 0: Fail fast if the account can't be merged — no new account is
  // created and no Friendbot call is wasted.
  try {
    await assertMergeable(oldPublicKey);
  } catch (err) {
    if (err instanceof KeypairRotationBlockedError) {
      logger.warn('keypairRotation.blocked', { oldPublicKey, userId, correlationId, details: err.details });
      throw err;
    }
    // Lookup failure (e.g. Horizon unreachable) — surface it rather than
    // silently proceeding to a merge that may also fail.
    logger.error('keypairRotation.precheck.failed', { oldPublicKey, correlationId, error: err.message });
    throw new Error(`Failed to verify account is mergeable: ${err.message}`);
  }

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
