/**
 * Email notification channel.
 * Uses nodemailer in production; stubs in development/test.
 */
import logger from '../../config/logger.js';

// Lazy-loaded nodemailer transport
let transport = null;

function getTransport() {
  if (transport) return transport;

  const { EMAIL_HOST, EMAIL_USER } = process.env;

  if (!EMAIL_HOST || !EMAIL_USER) {
    // No SMTP configured — use stub transport
    return null;
  }

  // nodemailer must be installed separately: npm install nodemailer
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport({
      host: EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT ?? '587', 10),
      secure: process.env.EMAIL_PORT === '465',
      auth: { user: EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    return transport;
  } catch {
    logger.warn('email.transport.unavailable', { reason: 'nodemailer not installed' });
    return null;
  }
}

const FROM_ADDRESS = process.env.EMAIL_FROM ?? 'noreply@futureremit.app';

/**
 * Send an email notification.
 * @param {string} to - Recipient email address
 * @param {{ subject: string, body: string }} content
 * @returns {Promise<{ success: boolean, messageId?: string, stub?: boolean }>}
 */
export async function sendEmail(to, { subject, body }) {
  const t = getTransport();

  if (!t) {
    // Stub: log and return success in non-production
    logger.info('email.stub.sent', { to, subject });
    return { success: true, stub: true };
  }

  try {
    const info = await t.sendMail({
      from: FROM_ADDRESS,
      to,
      subject,
      text: body,
    });
    logger.info('email.sent', { to, subject, messageId: info.messageId });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    logger.error('email.send.failed', { to, subject, error: err.message });
    return { success: false, error: err.message };
  }
}
