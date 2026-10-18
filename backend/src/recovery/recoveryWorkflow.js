import crypto from 'crypto';
import { StrKey } from '@stellar/stellar-sdk';
import prisma from '../db/client.js';
import logger from '../config/logger.js';
import { getContacts } from './contactManager.js';
import { sendEmail } from '../notifications/channels/email.js';
import { sendNotification } from '../notifications/service.js';
import { rotateRecoveredAccountSigner } from '../services/keypairRotation.js';
import { revokeAllSessions } from '../auth/sessionStore.js';
import { revokeUserTokens } from '../auth/refreshTokenStore.js';

// Recovery state lives in PostgreSQL (RecoveryRequest / RecoveryApproval) so
// requests survive restarts and are visible to every API node (#1387).

const DELAY_HOURS = 24; // mandatory time-lock before recovery completes
const MAX_ATTEMPTS = 5;
const EXPIRY_HOURS = 72;
const ACTIVE_STATUSES = ['pending', 'approved', 'completing'];

/** Thrown when a guardian approval cannot be authenticated (maps to HTTP 401). */
export class RecoveryAuthError extends Error {
  constructor(message = 'Invalid guardian approval token') {
    super(message);
    this.name = 'RecoveryAuthError';
    this.statusCode = 401;
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Compared even when no approval row matches so that unknown contacts and
// wrong tokens take the same time.
const DUMMY_TOKEN_HASH = hashToken(crypto.randomBytes(32).toString('hex'));

function tokenMatches(suppliedToken, storedHash) {
  const supplied = Buffer.from(hashToken(suppliedToken), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return supplied.length === stored.length && crypto.timingSafeEqual(supplied, stored);
}

function iso(date) {
  return date ? new Date(date).toISOString() : null;
}

// Public shape of a request. Approval token hashes never leave this module.
function serialize(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    method: row.method,
    status: row.status,
    attempts: row.attempts,
    ipAddress: row.ipAddress,
    newPublicKey: row.newPublicKey ?? null,
    rotationTxHash: row.rotationTxHash ?? null,
    initiatedAt: iso(row.initiatedAt),
    executeAfter: iso(row.executeAfter),
    expiresAt: iso(row.expiresAt),
    completedAt: iso(row.completedAt),
    approvals: (row.approvals || []).filter((a) => a.approvedAt).map((a) => a.contactId),
  };
}

function findRequestRow(requestId) {
  return prisma.recoveryRequest.findUnique({
    where: { id: requestId },
    include: { approvals: true },
  });
}

async function expireIfStale(request) {
  if (new Date() <= new Date(request.expiresAt)) return;
  await prisma.recoveryRequest.updateMany({
    where: { id: request.id, status: { in: ['pending', 'approved'] } },
    data: { status: 'expired' },
  });
  throw new Error('Recovery request has expired');
}

async function dispatchGuardianTokens(request, contacts, tokens) {
  await Promise.all(
    contacts.map(async (contact) => {
      const token = tokens.get(contact.id);
      try {
        const result = await sendEmail(contact.email, {
          subject: 'Account recovery approval requested',
          body:
            `Hi ${contact.name},\n\n` +
            `Someone has requested to recover an account that lists you as a trusted contact.\n` +
            `Only approve if you have personally confirmed this request with the account owner.\n\n` +
            `Request ID: ${request.id}\nContact ID: ${contact.id}\nApproval token: ${token}\n\n` +
            `This request expires at ${iso(request.expiresAt)}.`,
        });
        if (result && result.success === false) {
          throw new Error(result.error || 'Email delivery failed');
        }
      } catch (err) {
        logger.error(
          { err, requestId: request.id, contactId: contact.id },
          'Failed to dispatch guardian approval token',
        );
      }
    }),
  );
}

/**
 * Start a recovery request.
 *
 * For social recovery, a 32-byte random approval token is generated for each
 * confirmed guardian, delivered to them out-of-band by email, and only its
 * SHA-256 hash is persisted (#1388).
 *
 * @param {string} userId
 * @param {'phrase'|'social'} method
 * @param {string} ipAddress
 * @param {object} [opts]
 * @param {string} [opts.newPublicKey] - Client-generated Stellar key that will
 *   replace the lost key on completion (#1389). Bound to the request so
 *   guardians approve a specific key.
 */
export async function initiateRecovery(userId, method, ipAddress, { newPublicKey } = {}) {
  if (newPublicKey && !StrKey.isValidEd25519PublicKey(newPublicKey)) {
    throw new Error('Invalid newPublicKey');
  }

  const now = new Date();
  // Stale requests would otherwise block a new one via the active-request
  // unique index until something happened to touch them.
  await prisma.recoveryRequest.updateMany({
    where: { userId, status: { in: ['pending', 'approved'] }, expiresAt: { lt: now } },
    data: { status: 'expired' },
  });

  const existing = await getActiveRequest(userId);
  if (existing) throw new Error('Recovery already in progress');

  const guardians = method === 'social' ? getContacts(userId).filter((c) => c.confirmedAt) : [];
  if (method === 'social' && guardians.length === 0) {
    throw new Error('No confirmed recovery contacts');
  }
  const tokens = new Map(guardians.map((c) => [c.id, crypto.randomBytes(32).toString('hex')]));

  let row;
  try {
    row = await prisma.recoveryRequest.create({
      data: {
        userId,
        method, // 'phrase' | 'social'
        status: 'pending', // pending -> approved -> completing -> completed | cancelled
        ipAddress,
        newPublicKey: newPublicKey || null,
        initiatedAt: now,
        executeAfter: new Date(now.getTime() + DELAY_HOURS * 3600 * 1000),
        expiresAt: new Date(now.getTime() + EXPIRY_HOURS * 3600 * 1000),
        approvals: {
          create: guardians.map((c) => ({
            contactId: c.id,
            tokenHash: hashToken(tokens.get(c.id)),
          })),
        },
      },
      include: { approvals: true },
    });
  } catch (err) {
    // Partial unique index: another node won the race to open a request.
    if (err?.code === 'P2002') throw new Error('Recovery already in progress');
    throw err;
  }

  if (guardians.length) await dispatchGuardianTokens(row, guardians, tokens);
  return serialize(row);
}

export async function recordAttempt(requestId, success) {
  const request = await findRequestRow(requestId);
  if (!request) throw new Error('Recovery request not found');
  if (request.status !== 'pending') throw new Error('Recovery request is not active');
  await expireIfStale(request);

  const attempts = request.attempts + 1;
  let status = 'pending';
  if (success) status = 'approved';
  else if (attempts >= MAX_ATTEMPTS) status = 'locked';

  // Compare-and-set on the attempt counter so concurrent attempts on
  // different nodes can't both slip under MAX_ATTEMPTS.
  const { count } = await prisma.recoveryRequest.updateMany({
    where: { id: requestId, status: 'pending', attempts: request.attempts },
    data: { attempts, status },
  });
  if (count === 0) throw new Error('Recovery request was modified concurrently; retry');

  if (status === 'locked') throw new Error('Too many failed attempts. Recovery locked.');

  return serialize(await findRequestRow(requestId));
}

/**
 * Record a guardian approval. The guardian must present the out-of-band token
 * issued to them at initiation; it is checked against the stored SHA-256 hash
 * with a timing-safe comparison.
 *
 * @throws {RecoveryAuthError} When the contact/token pair does not verify.
 */
export async function addApproval(requestId, contactId, approvalToken) {
  const request = await findRequestRow(requestId);
  if (!request) throw new Error('Recovery request not found');
  if (request.status !== 'pending') throw new Error('Recovery request is not active');
  await expireIfStale(request);

  if (typeof approvalToken !== 'string' || approvalToken.length === 0) {
    throw new RecoveryAuthError('Guardian approval token required');
  }

  const approval = request.approvals.find((a) => a.contactId === contactId);
  const valid = tokenMatches(approvalToken, approval?.tokenHash ?? DUMMY_TOKEN_HASH);
  if (!approval || !valid) {
    logger.warn({ requestId, contactId }, 'Rejected unauthenticated guardian approval');
    throw new RecoveryAuthError();
  }

  if (!approval.approvedAt) {
    await prisma.recoveryApproval.updateMany({
      where: { id: approval.id, approvedAt: null },
      data: { approvedAt: new Date() },
    });
  }

  return serialize(await findRequestRow(requestId));
}

/**
 * Complete an approved recovery once the time-lock has elapsed (#1389):
 *   1. Claim the request (approved -> completing) so only one node proceeds
 *   2. Rotate signers on-chain via setOptions (new key in, lost key zeroed)
 *   3. Persist the new public key and mark the request completed
 *   4. Revoke every refresh token and session for the user
 *   5. Notify the user out-of-band
 *
 * @param {string} requestId
 * @param {object} [opts]
 * @param {string} [opts.newPublicKey] - Required if not supplied at initiation;
 *   must match the bound key if it was.
 */
export async function completeRecovery(requestId, { newPublicKey } = {}) {
  const request = await findRequestRow(requestId);
  if (!request) throw new Error('Recovery request not found');
  if (request.status !== 'approved') throw new Error('Recovery not approved');
  if (new Date() < new Date(request.executeAfter)) {
    const remaining = Math.ceil((new Date(request.executeAfter) - new Date()) / 3600000);
    throw new Error(`Time-lock active. ${remaining}h remaining before recovery can complete.`);
  }

  if (request.newPublicKey && newPublicKey && newPublicKey !== request.newPublicKey) {
    throw new Error('newPublicKey does not match the key bound to this recovery request');
  }
  const targetKey = request.newPublicKey || newPublicKey;
  if (!targetKey || !StrKey.isValidEd25519PublicKey(targetKey)) {
    throw new Error('A valid newPublicKey is required to complete recovery');
  }

  const user = await prisma.user.findUnique({ where: { id: request.userId } });
  if (!user) throw new Error('User not found');
  const oldPublicKey = user.publicKey;

  const claimed = await prisma.recoveryRequest.updateMany({
    where: { id: requestId, status: 'approved' },
    data: { status: 'completing', newPublicKey: targetKey, oldPublicKey },
  });
  if (claimed.count === 0) throw new Error('Recovery not approved');

  let rotation;
  try {
    rotation = await rotateRecoveredAccountSigner({
      accountId: oldPublicKey,
      oldPublicKey,
      newPublicKey: targetKey,
      correlationId: requestId,
    });
  } catch (err) {
    // Nothing changed on-chain; release the claim so completion can be retried.
    await prisma.recoveryRequest.updateMany({
      where: { id: requestId, status: 'completing' },
      data: { status: 'approved' },
    });
    throw err;
  }

  const completedAt = new Date();
  try {
    await prisma.$transaction([
      prisma.user.update({ where: { id: request.userId }, data: { publicKey: targetKey } }),
      prisma.recoveryRequest.update({
        where: { id: requestId },
        data: { status: 'completed', completedAt, rotationTxHash: rotation.hash },
      }),
      prisma.refreshToken.updateMany({
        where: { userId: request.userId, isRevoked: false },
        data: { isRevoked: true },
      }),
    ]);
  } catch (err) {
    logger.error(
      { err, requestId, oldPublicKey, newPublicKey: targetKey, txHash: rotation.hash },
      'CRITICAL: on-chain recovery rotation succeeded but DB update failed. ' +
        'Manual intervention required.',
    );
    throw new Error(`DB update failed after on-chain rotation (tx ${rotation.hash})`);
  }

  revokeUserTokens(request.userId);
  let revokedSessions = 0;
  try {
    revokedSessions = await revokeAllSessions(request.userId);
  } catch (err) {
    logger.error(
      { err, requestId, userId: request.userId },
      'Failed to revoke sessions after recovery',
    );
  }

  try {
    await sendNotification({
      userId: request.userId,
      type: 'account_recovery_completed',
      data: {
        requestId,
        oldPublicKey,
        newPublicKey: targetKey,
        txHash: rotation.hash,
        revokedSessions,
        completedAt: completedAt.toISOString(),
      },
    });
  } catch (err) {
    logger.warn({ err, requestId }, 'Recovery completion notification failed');
  }

  return serialize(await findRequestRow(requestId));
}

export async function cancelRecovery(requestId, userId) {
  const request = await findRequestRow(requestId);
  if (!request) throw new Error('Recovery request not found');
  if (request.userId !== userId) throw new Error('Unauthorized');
  if (!['pending', 'approved'].includes(request.status)) {
    throw new Error('Cannot cancel a completed or already cancelled request');
  }
  const { count } = await prisma.recoveryRequest.updateMany({
    where: { id: requestId, status: { in: ['pending', 'approved'] } },
    data: { status: 'cancelled', cancelledAt: new Date() },
  });
  if (count === 0) throw new Error('Cannot cancel a completed or already cancelled request');
  return serialize(await findRequestRow(requestId));
}

export async function getActiveRequest(userId) {
  const row = await prisma.recoveryRequest.findFirst({
    where: { userId, status: { in: ACTIVE_STATUSES } },
    include: { approvals: true },
    orderBy: { initiatedAt: 'desc' },
  });
  return serialize(row);
}

export async function getRequest(requestId) {
  return serialize(await findRequestRow(requestId));
}

export async function getUserRequests(userId) {
  const rows = await prisma.recoveryRequest.findMany({
    where: { userId },
    include: { approvals: true },
    orderBy: { initiatedAt: 'asc' },
  });
  return rows.map(serialize);
}
