'use strict';

const nodemailer = require('nodemailer');

/**
 * Email notification channel.
 *
 * Sends transactional emails (registration verification, alerts, etc.)
 * through the configured SMTP transport. When SMTP is not configured the
 * channel falls back to a no-op logger so local/dev environments keep
 * working without credentials.
 */

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
