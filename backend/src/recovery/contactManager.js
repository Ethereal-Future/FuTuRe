import crypto from 'crypto';
import { sendEmail } from '../notifications/channels/email.js';
import logger from '../config/logger.js';

// In-memory store for recovery contacts (replace with DB in production)
const recoveryContacts = new Map(); // userId -> [{ id, email, name, confirmedAt }]

// In-memory OTP store: contactId -> { otp, expiresAt, attempts, channel }
// Replace with Redis / DB in production so TTL is enforced server-side
const pendingOtps = new Map();

const OTP_TTL_MS = 10 * 60 * 1000;   // 10 minutes
const OTP_MAX_ATTEMPTS = 5;           // max wrong guesses before invalidation
const OTP_LENGTH = 6;                 // digits

// ── Internal helpers ─────────────────────────────────────────────────────────

function generateOtp() {
  // Cryptographically secure 6-digit code, zero-padded
  return String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

function hashOtp(otp) {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

/**
 * Hash an approval token with SHA-256. Approval tokens are 32 random bytes
 * (hex-encoded) generated at recovery initiation and dispatched out-of-band
 * to the guardian. Only the hash is ever stored.
 *
 * @param {string} token
 * @returns {string} hex-encoded SHA-256 digest
 */
export function hashApprovalToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Generate a cryptographically secure 32-byte approval token.
 *
 * @returns {{ token: string, tokenHash: string }}
 */
export function generateApprovalToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, tokenHash: hashApprovalToken(token) };
}

// ── Public API ───────────────────────────────────────────────────────────────

export function addContact(userId, email, name) {
  const contacts = recoveryContacts.get(userId) || [];
  if (contacts.length >= 5) throw new Error('Maximum 5 recovery contacts allowed');
  if (contacts.some(c => c.email === email)) throw new Error('Contact already exists');

  const contact = {
    id: crypto.randomUUID(),
    email,
    name,
    // Contact starts unconfirmed; confirmedAt is set only after OTP challenge passes
    confirmedAt: null,
    // Hash of the per-guardian approval token (set at recovery initiation).
    // The plaintext token is only ever sent out-of-band to the guardian.
    tokenHash: null,
    addedAt: new Date().toISOString(),
  };
  contacts.push(contact);
  recoveryContacts.set(userId, contacts);
  return contact;
}

/**
 * Begin the out-of-band verification challenge for a newly added contact.
 * Generates a 6-digit OTP, stores a bcrypt-equivalent hash with a 10-minute
 * TTL, and dispatches it to the contact's registered email address.
 *
 * Must be called after addContact() and before confirmContact().
 *
 * @param {string} userId
 * @param {string} contactId
 * @returns {Promise<{ sent: boolean, expiresAt: string }>}
 */
export async function initiateContactVerification(userId, contactId) {
  const contacts = recoveryContacts.get(userId) || [];
  const contact = contacts.find(c => c.id === contactId);
  if (!contact) throw new Error('Contact not found');
  if (contact.confirmedAt) throw new Error('Contact is already verified');

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  // Store hash — never the plaintext OTP
  pendingOtps.set(contactId, {
    otpHash: hashOtp(otp),
    expiresAt,
    attempts: 0,
    channel: 'email',
  });

  // Dispatch OTP to the contact's address
  try {
    await sendEmail({
      to: contact.email,
      subject: 'Verify your recovery contact – one-time code',
      text:
        `Hi ${contact.name},\n\n` +
        `You have been added as a trusted recovery contact.\n\n` +
        `Your verification code is: ${otp}\n\n` +
        `This code expires in 10 minutes. If you did not expect this, ` +
        `please ignore this message.`,
      html:
        `<p>Hi ${contact.name},</p>` +
        `<p>You have been added as a trusted recovery contact.</p>` +
        `<p>Your verification code is: <strong>${otp}</strong></p>` +
        `<p>This code expires in 10 minutes. If you did not expect this, ` +
        `please ignore this message.</p>`,
    });
  } catch (err) {
    // Clean up the pending OTP so the caller can retry
    pendingOtps.delete(contactId);
    logger.error({ err, contactId }, 'Failed to send contact verification OTP');
    throw new Error('Could not dispatch verification code; please retry');
  }

  logger.info({ userId, contactId, channel: 'email' }, 'Contact verification OTP dispatched');
  return { sent: true, expiresAt };
}

/**
 * Verify the OTP submitted by the recovery contact and, on success, mark
 * the contact as confirmed.
 *
 * Enforces:
 *   - Expiry (10 minutes)
 *   - Attempt rate-limit (5 wrong guesses invalidate the code)
 *   - Constant-time comparison to prevent timing attacks
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {string} otp  The code entered by the contact
 * @returns {{ verified: boolean, contact?: object, reason?: string }}
 */
export function verifyContactOtp(userId, contactId, otp) {
  const contacts = recoveryContacts.get(userId) || [];
  const contact = contacts.find(c => c.id === contactId);
  if (!contact) throw new Error('Contact not found');

  const pending = pendingOtps.get(contactId);
  if (!pending) {
    return { verified: false, reason: 'No verification challenge found; call initiateContactVerification first' };
  }

  // Expiry check
  if (Date.now() > new Date(pending.expiresAt).getTime()) {
    pendingOtps.delete(contactId);
    return { verified: false, reason: 'Verification code has expired' };
  }

  // Attempt-rate check
  if (pending.attempts >= OTP_MAX_ATTEMPTS) {
    pendingOtps.delete(contactId);
    return { verified: false, reason: 'Too many incorrect attempts; please request a new code' };
  }

  // Constant-time comparison against hash
  const supplied = Buffer.from(hashOtp(String(otp)));
  const stored   = Buffer.from(pending.otpHash);
  const match =
    supplied.length === stored.length &&
    crypto.timingSafeEqual(supplied, stored);

  if (!match) {
    pending.attempts += 1;
    logger.warn({ userId, contactId, attempts: pending.attempts }, 'Contact OTP mismatch');
    return { verified: false, reason: 'Invalid verification code' };
  }

  // Success — clean up OTP and confirm the contact
  pendingOtps.delete(contactId);
  contact.confirmedAt = new Date().toISOString();
  logger.info({ userId, contactId }, 'Recovery contact verified via OTP');
  return { verified: true, contact };
}

/**
 * Confirm a contact by ID.
 * Kept for backwards compatibility but now requires the OTP challenge to have
 * been completed first — contacts without a confirmedAt set via verifyContactOtp
 * cannot be confirmed through this path alone.
 *
 * @deprecated Prefer verifyContactOtp() which handles confirmation atomically.
 */
export function confirmContact(userId, contactId) {
  const contacts = recoveryContacts.get(userId) || [];
  const contact = contacts.find(c => c.id === contactId);
  if (!contact) throw new Error('Contact not found');

  // Guard: refuse to confirm if the OTP challenge was never completed
  if (!contact.confirmedAt) {
    throw new Error(
      'Cannot confirm contact: out-of-band OTP verification has not been completed. ' +
      'Call initiateContactVerification then verifyContactOtp first.',
    );
  }
  return contact;
}

export function removeContact(userId, contactId) {
  const contacts = recoveryContacts.get(userId) || [];
  const filtered = contacts.filter(c => c.id !== contactId);
  if (filtered.length === contacts.length) throw new Error('Contact not found');
  pendingOtps.delete(contactId);
  recoveryContacts.set(userId, filtered);
}

export function getContacts(userId) {
  return recoveryContacts.get(userId) || [];
}

export function getConfirmedContactCount(userId) {
  return getContacts(userId).filter(c => c.confirmedAt).length;
}

/**
 * Store the hash of a guardian's approval token. The plaintext token must
 * never be persisted — only its SHA-256 hash.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {string} tokenHash
 * @returns {object} the updated contact
 */
export function setContactTokenHash(userId, contactId, tokenHash) {
  const contacts = recoveryContacts.get(userId) || [];
  const contact = contacts.find(c => c.id === contactId);
  if (!contact) throw new Error('Contact not found');
  contact.tokenHash = tokenHash;
  return contact;
}

/**
 * Retrieve a guardian by their approval token hash.
 *
 * Used by the recovery workflow to resolve which guardian a submitted
 * approval token belongs to, without ever trusting a caller-supplied
 * contactId.
 *
 * @param {string} userId
 * @param {string} tokenHash
 * @returns {object|undefined} the matching contact, if any
 */
export function getContactByTokenHash(userId, tokenHash) {
  if (!tokenHash) return undefined;
  const contacts = recoveryContacts.get(userId) || [];
  return contacts.find(c => c.tokenHash && c.tokenHash === tokenHash);
}

/**
 * Retrieve a guardian by ID (internal helper).
 *
 * @param {string} userId
 * @param {string} contactId
 * @returns {object|undefined}
 */
export function getContactById(userId, contactId) {
  const contacts = recoveryContacts.get(userId) || [];
  return contacts.find(c => c.id === contactId);
}
