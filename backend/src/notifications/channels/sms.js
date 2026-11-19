/**
 * SMS notification channel.
 *
 * Recipients are normalized to E.164 before dispatch. Twilio is the primary
 * carrier; when SMS_FAILOVER_PROVIDER=sns, AWS SNS is used as a secondary route
 * if Twilio is down (5xx / network / rate limit) or refuses to route to the
 * destination (geo-permission or carrier filtering). Stubs when no provider is configured.
 */
import logger from '../../config/logger.js';
import { normalizePhoneNumber } from '../../utils/phone.js';

// Lazy-loaded provider clients
let twilioClient = null;
let snsClient = null;
let snsModule = null;

/**
 * Lazily initialise and cache a Twilio client.
 * Uses dynamic import() — the ESM-safe equivalent of require() — so that the
 * `twilio` package remains an optional dependency: if it is not installed the
 * import rejects and we log a clear warning instead of silently stubbing.
 *
 * @returns {Promise<object|null>}
 */
async function getTwilioClient() {
  if (twilioClient) return twilioClient;

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;

  // twilio must be installed separately: npm install twilio
  try {
    const { default: twilio } = await import('twilio');
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    return twilioClient;
  } catch {
    logger.warn('sms.twilio.unavailable', { reason: 'twilio not installed' });
    return null;
  }
}

/**
 * Lazily initialise and cache an AWS SNS client (optional `@aws-sdk/client-sns`).
 * Credentials come from the default AWS provider chain (e.g. the ECS task role).
 *
 * @returns {Promise<object|null>}
 */
async function getSnsClient() {
  if (snsClient) return snsClient;
  if (process.env.SMS_FAILOVER_PROVIDER !== 'sns') return null;

  try {
    snsModule = await import('@aws-sdk/client-sns');
    snsClient = new snsModule.SNSClient({ region: process.env.AWS_SNS_REGION ?? process.env.AWS_REGION });
    return snsClient;
  } catch {
    logger.warn('sms.sns.unavailable', { reason: '@aws-sdk/client-sns not installed' });
    return null;
  }
}

const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER ?? '+10000000000';

// Twilio REST error codes where another carrier route may still deliver the message
const TWILIO_ROUTING_ERROR_CODES = new Set([
  21408, // Permission to send an SMS has not been enabled for the region
  21612, // The 'To' number is not currently reachable via SMS
  30007, // Message filtered by carrier
  30008, // Unknown carrier error
]);

/**
 * Whether a primary-provider failure should be retried on the secondary carrier.
 * Client errors (invalid number, opted-out recipient, bad credentials) are not
 * retried: a different carrier would fail the same way or would bypass an opt-out.
 */
export function isFailoverEligible(err) {
  const status = err?.status ?? err?.statusCode;
  if (TWILIO_ROUTING_ERROR_CODES.has(Number(err?.code))) return true;
  if (status === undefined || status === null) return true; // network error / timeout
  return status >= 500 || status === 429;
}

const providers = [
  {
    name: 'twilio',
    getClient: getTwilioClient,
    async send(client, to, body) {
      const message = await client.messages.create({ from: FROM_NUMBER, to, body });
      return message.sid;
    },
  },
  {
    name: 'sns',
    getClient: getSnsClient,
    async send(client, to, body) {
      const attributes = {
        'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
      };
      if (process.env.AWS_SNS_SENDER_ID) {
        attributes['AWS.SNS.SMS.SenderID'] = { DataType: 'String', StringValue: process.env.AWS_SNS_SENDER_ID };
      }
      const result = await client.send(
        new snsModule.PublishCommand({ PhoneNumber: to, Message: body, MessageAttributes: attributes }),
      );
      return result.MessageId;
    },
  },
];

/**
 * Send an SMS notification.
 * @param {string} to - Phone number; E.164 preferred, national format accepted with `defaultRegion`
 * @param {{ body: string }} content
 * @param {{ defaultRegion?: string }} [options] - ISO 3166-1 alpha-2 region for national-format numbers (falls back to SMS_DEFAULT_REGION)
 * @returns {Promise<{ success: boolean, sid?: string, provider?: string, stub?: boolean, error?: string }>}
 */
export async function sendSms(to, { body }, { defaultRegion } = {}) {
  const e164 = normalizePhoneNumber(to, defaultRegion ?? process.env.SMS_DEFAULT_REGION);
  if (!e164) {
    logger.warn('sms.invalid_number', { region: defaultRegion ?? process.env.SMS_DEFAULT_REGION ?? null });
    return { success: false, error: 'invalid_phone_number' };
  }

  const available = [];
  for (const provider of providers) {
    const client = await provider.getClient();
    if (client) available.push({ provider, client });
  }

  if (available.length === 0) {
    logger.info('sms.stub.sent', { to: e164, body: body.slice(0, 40) });
    return { success: true, stub: true };
  }

  let lastError;
  for (const [i, { provider, client }] of available.entries()) {
    try {
      const sid = await provider.send(client, e164, body);
      logger.info('sms.sent', { to: e164, provider: provider.name, sid, failover: i > 0 });
      return { success: true, sid, provider: provider.name };
    } catch (err) {
      lastError = err;
      const hasNext = i < available.length - 1;
      const failover = hasNext && isFailoverEligible(err);
      logger[failover ? 'warn' : 'error']('sms.send.failed', {
        to: e164,
        provider: provider.name,
        status: err.status ?? err.statusCode,
        code: err.code,
        error: err.message,
        failover,
      });
      if (!failover) break;
    }
  }

  return { success: false, error: lastError.message };
}
