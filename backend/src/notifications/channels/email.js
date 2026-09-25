'use strict';

const nodemailer = require('nodemailer');

/**
 * Email notification channel.
 * Uses nodemailer in production; stubs in development/test.
 *
 * Outbound mail is DKIM-signed when DKIM_DOMAIN, DKIM_KEY_SELECTOR and
 * DKIM_PRIVATE_KEY are configured. See docs/guides/email-setup.md for the
 * SPF / DKIM / DMARC DNS records required for inbox deliverability.
 *
 * Sends transactional emails (registration verification, alerts, etc.)
 * through the configured SMTP transport. When SMTP is not configured the
 * channel falls back to a no-op logger so local/dev environments keep
 * working without credentials.
 */

// Lazily-created nodemailer transport (cached promise so concurrent sends share one)
let transportPromise = null;
let fromAddress = 'noreply@futureremit.app';

/**
 * Lazily initialise and cache a nodemailer transport.
 * Uses dynamic import() so `nodemailer` remains an optional dependency.
 *
 * @returns {Promise<object|null>}
 */
function getTransport() {
  const { EMAIL_HOST, EMAIL_USER } = process.env;

  if (!EMAIL_HOST || !EMAIL_USER) {
    // No SMTP configured — use stub transport
    return Promise.resolve(null);
  }

  transportPromise ??= createTransport(EMAIL_HOST, EMAIL_USER).catch((err) => {
    transportPromise = null;
    throw err;
  });
  return transportPromise;
}

async function createTransport(host, user) {
  let nodemailer;
  try {
    ({ default: nodemailer } = await import('nodemailer'));
  } catch {
    logger.warn('email.transport.unavailable', { reason: 'nodemailer not installed' });
    return null;
  }

  const { getConfig } = await import('../../config/env.js');
  const { from, dkim } = getConfig().email;
  fromAddress = from;

  if (dkim) {
    const fromDomain = extractDomain(from);
    if (fromDomain && !isAlignedDomain(fromDomain, dkim.domainName)) {
      // DMARC requires the From: domain to align with the DKIM d= domain
      logger.warn('email.dkim.misaligned', { fromDomain, dkimDomain: dkim.domainName });
    }
  } else if (process.env.NODE_ENV === 'production') {
    logger.warn('email.dkim.disabled', {
      reason: 'DKIM_DOMAIN / DKIM_KEY_SELECTOR / DKIM_PRIVATE_KEY not set; mail is likely to be rejected or marked as spam',
    });
  }

  const port = parseInt(process.env.EMAIL_PORT ?? '587', 10);
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass: process.env.EMAIL_PASS },
    ...(dkim && {
      dkim: {
        domainName: dkim.domainName,
        keySelector: dkim.keySelector,
        privateKey: dkim.privateKey,
      },
    }),
  });
}

function extractDomain(address) {
  const match = /@([^>\s]+)>?\s*$/.exec(address ?? '');
  return match ? match[1].toLowerCase() : null;
}

// Relaxed DMARC alignment: From domain equals, or is a subdomain of, the DKIM domain
function isAlignedDomain(fromDomain, dkimDomain) {
  const d = dkimDomain.toLowerCase();
  return fromDomain === d || fromDomain.endsWith(`.${d}`);
}

/**
 * Send an email notification.
 * @param {string} to - Recipient email address
 * @param {{ subject: string, body: string, html?: string }} content - `body` is plain text; `html` is an already-escaped HTML version
 * @returns {Promise<{ success: boolean, messageId?: string, stub?: boolean }>}
 */
export async function sendEmail(to, { subject, body, html }) {
  let t;
  try {
    t = await getTransport();
  } catch (err) {
    logger.error('email.transport.failed', { error: err.message });
    return { success: false, error: err.message };
  }
let transporter = null;

function getTransporter() {
  if (transporter) {
    return transporter;
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_HOST) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT ? Number(SMTP_PORT) : 587,
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER
      ? {
          user: SMTP_USER,
          pass: SMTP_PASS,
        }
      : undefined,
  });

  return transporter;
}

/**
 * Send an email message.
 *
 * @param {Object} message
 * @param {string} message.to      Recipient address.
 * @param {string} message.subject Subject line.
 * @param {string} message.text    Plain-text body.
 * @param {string} [message.html]  Optional HTML body.
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
async function sendEmail({ to, subject, text, html }) {
  if (!to || !subject) {
    throw new Error('sendEmail requires "to" and "subject"');
  }

  const transport = getTransporter();

  if (!transport) {
    // No SMTP configured: log and report as not sent so callers can decide.
    // eslint-disable-next-line no-console
    console.warn(`[email] SMTP not configured, skipping email to ${to}: ${subject}`);
    return { sent: false, reason: 'smtp_not_configured' };
  }

  try {
    const info = await t.sendMail({
      from: fromAddress,
      to,
      subject,
      text: body,
      ...(html && { html }),
    });
    logger.info('email.sent', { to, subject, messageId: info.messageId });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    logger.error('email.send.failed', { to, subject, error: err.message });
    return { success: false, error: err.message };
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@localhost',
    to,
    subject,
    text,
    html,
  });

  return { sent: true };
}

/**
 * Dispatch a registration verification challenge (OTP / token) to a newly
 * registered account. The token is short-lived (15 minutes) and must be
 * presented back to POST /api/auth/verify-email before the account is
 * promoted to ACTIVE.
 *
 * @param {Object} params
 * @param {string} params.to    Recipient email address.
 * @param {string} params.token Verification token / OTP.
 * @param {number} [params.ttlMinutes=15] Token lifetime in minutes.
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
async function sendVerificationEmail({ to, token, ttlMinutes = 15 }) {
  if (!to || !token) {
    throw new Error('sendVerificationEmail requires "to" and "token"');
  }

  const subject = 'Verify your email address';
  const text =
    `Your verification code is: ${token}\n\n` +
    `This code expires in ${ttlMinutes} minutes. ` +
    'If you did not create an account, you can safely ignore this email.';
  const html =
    `<p>Your verification code is: <strong>${token}</strong></p>` +
    `<p>This code expires in ${ttlMinutes} minutes.</p>` +
    '<p>If you did not create an account, you can safely ignore this email.</p>';

  return sendEmail({ to, subject, text, html });
}

module.exports = {
  sendEmail,
  sendVerificationEmail,
};
