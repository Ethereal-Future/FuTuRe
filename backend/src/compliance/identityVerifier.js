import kycCollector, { KYC_STATUS } from './kycCollector.js';
import sanctionsChecker from './sanctionsChecker.js';

const APP_ENV = (process.env.APP_ENV || process.env.NODE_ENV || 'development').trim().toLowerCase();
const IS_DEPLOYED = APP_ENV === 'production' || APP_ENV === 'staging';

const MIN_AGE_YEARS = 18;
const MIN_IMAGE_DIMENSION = 300;
const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff'];

// Country-specific document number patterns. Keys are ISO 3166-1 alpha-2 codes.
const DOCUMENT_NUMBER_PATTERNS = {
  US: /^[0-9]{9}$/, // US passport: 9 digits
  GB: /^[0-9]{9}$/, // UK passport: 9 digits
  CA: /^[A-Z]{2}[0-9]{6}$/, // Canadian passport: 2 letters + 6 digits
  AU: /^[A-Z][0-9]{7}$/, // Australian passport: 1 letter + 7 digits
  DE: /^[0-9A-Z]{9}$/, // German passport: 9 alphanumeric
  FR: /^[0-9]{2}[A-Z]{2}[0-9]{5}$/, // French passport: 2 digits + 2 letters + 5 digits
};

function calculateAge(dob, now = new Date()) {
  const birth = new Date(dob);
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

// No real identity verification provider (e.g. Jumio, Onfido) is integrated yet.
// _callProvider is a placeholder that cannot perform real document checks — see
// its own comment below for what it actually does and why it's gated.
class IdentityVerifier {
  async verify(userId) {
    const record = await kycCollector.getKYCRecord(userId);
    if (!record) throw new Error(`No KYC submission found for user ${userId}`);

    // 1. Sanctions check
    const sanctioned = await sanctionsChecker.check(record.fullName, record.nationality);
    if (sanctioned.hit) {
      if (sanctioned.screeningError) {
        // Screening couldn't run (unconfigured/unavailable) — that's not proof of
        // a match, so route to manual review instead of auto-rejecting.
        await kycCollector.updateStatus(userId, KYC_STATUS.UNDER_REVIEW, `Sanctions screening unavailable: ${sanctioned.reason}`);
        return { verified: false, reason: 'sanctions_screening_unavailable', detail: sanctioned.reason };
      }
      await kycCollector.updateStatus(userId, KYC_STATUS.REJECTED, `Sanctions match: ${sanctioned.reason}`);
      return { verified: false, reason: 'sanctions_hit', detail: sanctioned.reason };
    }

    // 2. Document validation
    const docResult = await this._callProvider(record);
    if (!docResult.valid) {
      await kycCollector.updateStatus(userId, KYC_STATUS.REJECTED, `Document invalid: ${docResult.reason}`);
      return { verified: false, reason: 'document_invalid', detail: docResult.reason };
    }

    if (docResult.requiresManualReview) {
      await kycCollector.updateStatus(userId, KYC_STATUS.UNDER_REVIEW, docResult.reason);
      return { verified: false, reason: 'manual_review_required', detail: docResult.reason };
    }

    await kycCollector.updateStatus(userId, KYC_STATUS.APPROVED, 'Identity verified successfully');
    return { verified: true };
  }

  // Placeholder only: performs local structural validation (document number
  // format, expiry date, applicant age, and basic image integrity) but is NOT
  // identity verification and must never auto-approve KYC. It refuses to run
  // in production/staging, and elsewhere it always routes passing submissions
  // to manual review rather than approving them. Replace with a real provider
  // SDK (Jumio, Onfido, etc.) before removing the manual-review gate.
  async _callProvider(data) {
    if (IS_DEPLOYED) {
      throw new Error(
        `identityVerifier: no real document verification provider is configured; the placeholder is disabled in ${APP_ENV}`
      );
    }

    const numberCheck = this._validateDocumentNumber(data);
    if (!numberCheck.valid) return numberCheck;

    const expiryCheck = this._validateExpiryDate(data);
    if (!expiryCheck.valid) return expiryCheck;

    const ageCheck = this._validateAge(data);
    if (!ageCheck.valid) return ageCheck;

    const imageCheck = this._validateImageIntegrity(data);
    if (!imageCheck.valid) return imageCheck;

    return {
      valid: true,
      requiresManualReview: true,
      reason: 'Automated document verification is not implemented in this environment; routed for manual review',
    };
  }

  _validateDocumentNumber(data) {
    const number = data.documentNumber;
    if (!number || typeof number !== 'string' || number.length < 5) {
      return { valid: false, reason: 'Document number too short' };
    }

    const country = (data.issuingCountry || data.nationality || '').toUpperCase();
    const pattern = DOCUMENT_NUMBER_PATTERNS[country];
    if (pattern && !pattern.test(number.trim().toUpperCase())) {
      return {
        valid: false,
        reason: `Document number does not match the expected format for issuing country ${country}`,
      };
    }

    return { valid: true };
  }

  _validateExpiryDate(data) {
    if (!data.expiryDate) {
      return { valid: false, reason: 'Document expiry date is missing' };
    }
    const expiry = new Date(data.expiryDate);
    if (Number.isNaN(expiry.getTime())) {
      return { valid: false, reason: 'Document expiry date is not a valid date' };
    }
    if (expiry <= new Date()) {
      return { valid: false, reason: `Document expired on ${expiry.toISOString().slice(0, 10)}` };
    }
    return { valid: true };
  }

  _validateAge(data) {
    if (!data.dob) {
      return { valid: false, reason: 'Date of birth is missing' };
    }
    const birth = new Date(data.dob);
    if (Number.isNaN(birth.getTime())) {
      return { valid: false, reason: 'Date of birth is not a valid date' };
    }
    const age = calculateAge(birth);
    if (age < MIN_AGE_YEARS) {
      return { valid: false, reason: `Applicant is under the minimum age of ${MIN_AGE_YEARS}` };
    }
    return { valid: true };
  }

  _validateImageIntegrity(data) {
    const image = data.documentImage || data.image;
    if (!image) {
      return { valid: false, reason: 'Document image is missing' };
    }

    const mimeType = (image.mimeType || image.contentType || '').toLowerCase();
    if (!mimeType || !ALLOWED_IMAGE_MIME_TYPES.includes(mimeType)) {
      return { valid: false, reason: `Unsupported document image MIME type: ${mimeType || 'unknown'}` };
    }

    const { width, height } = image;
    if (typeof width !== 'number' || typeof height !== 'number' || width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
      return {
        valid: false,
        reason: `Document image resolution too low (minimum ${MIN_IMAGE_DIMENSION}x${MIN_IMAGE_DIMENSION})`,
      };
    }

    if (image.metadataTampered === true || image.tampered === true) {
      return { valid: false, reason: 'Document image metadata indicates tampering' };
    }

    return { valid: true };
  }
}

export default new IdentityVerifier();
