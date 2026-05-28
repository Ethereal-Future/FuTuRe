/**
 * SMS notification channel.
 * Integrates with Twilio when configured; stubs otherwise.
 */
import logger from '../../config/logger.js';

// Lazy-loaded Twilio client
let twilioClient = null;

function getTwilioClient() {
  if (twilioClient) return twilioClient;

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;

  // twilio must be installed separately: npm install twilio
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const twilio = require('twilio');
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    return twilioClient;
  } catch {
    logger.warn('sms.twilio.unavailable', { reason: 'twilio not installed' });
    return null;
  }
}

const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER ?? '+10000000000';

/**
 * Send an SMS notification.
 * @param {string} to - E.164 phone number (e.g. '+14155552671')
 * @param {{ body: string }} content
 * @returns {Promise<{ success: boolean, sid?: string, stub?: boolean }>}
 */
export async function sendSms(to, { body }) {
  const client = getTwilioClient();

  if (!client) {
    logger.info('sms.stub.sent', { to, body: body.slice(0, 40) });
    return { success: true, stub: true };
  }

  try {
    const message = await client.messages.create({ from: FROM_NUMBER, to, body });
    logger.info('sms.sent', { to, sid: message.sid });
    return { success: true, sid: message.sid };
  } catch (err) {
    logger.error('sms.send.failed', { to, error: err.message });
    return { success: false, error: err.message };
  }
}
