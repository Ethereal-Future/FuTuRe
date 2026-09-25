/**
 * Phone number validation and E.164 normalization (google-libphonenumber).
 */
import libphonenumber from 'google-libphonenumber';

const { PhoneNumberUtil, PhoneNumberFormat } = libphonenumber;
const phoneUtil = PhoneNumberUtil.getInstance();

/**
 * Normalize a user-entered phone number to strict E.164 (e.g. '+2348031234567').
 *
 * Numbers already in international form ('+44 20 7946 0958', '00234 803 123 4567')
 * are parsed on their own; national-format numbers ('(555) 123-4567', '0712345678')
 * need `defaultRegion` — the ISO 3166-1 alpha-2 country code of the user.
 *
 * @param {string} raw - Phone number as entered
 * @param {string} [defaultRegion] - ISO 3166-1 alpha-2 region, e.g. 'US', 'GB', 'NG', 'PH'
 * @returns {string|null} E.164 number, or null if it cannot be parsed or is not a valid number
 */
export function normalizePhoneNumber(raw, defaultRegion) {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;

  // Convert the international "00" dialling prefix so it parses without a region
  const input = raw.trim().replace(/^00(?=[1-9])/, '+');
  const region = typeof defaultRegion === 'string' ? defaultRegion.trim().toUpperCase() : undefined;

  try {
    const parsed = phoneUtil.parseAndKeepRawInput(input, region || undefined);
    if (!phoneUtil.isValidNumber(parsed)) return null;
    return phoneUtil.format(parsed, PhoneNumberFormat.E164);
  } catch {
    return null;
  }
}

/**
 * @param {string} raw
 * @param {string} [defaultRegion]
 * @returns {boolean}
 */
export function isValidPhoneNumber(raw, defaultRegion) {
  return normalizePhoneNumber(raw, defaultRegion) !== null;
}

/**
 * Whether `code` is an ISO region libphonenumber knows (e.g. 'NG', 'PH').
 * @param {string} code
 * @returns {boolean}
 */
export function isSupportedRegion(code) {
  return typeof code === 'string' && phoneUtil.getSupportedRegions().includes(code.toUpperCase());
}
