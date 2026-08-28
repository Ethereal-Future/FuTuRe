import kycCollector, { KYC_STATUS } from './kycCollector.js';
import sanctionsChecker from './sanctionsChecker.js';

const APP_ENV = (process.env.APP_ENV || process.env.NODE_ENV || 'development').trim().toLowerCase();
const IS_DEPLOYED = APP_ENV === 'production' || APP_ENV === 'staging';

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

  // Placeholder only: checks that a document number string is present and >=5
  // characters. This is NOT identity verification and must never auto-approve
  // KYC. It refuses to run in production/staging, and elsewhere it always
  // routes passing submissions to manual review rather than approving them.
  // Replace with a real provider SDK (Jumio, Onfido, etc.) before removing
  // the manual-review gate.
  async _callProvider(data) {
    if (IS_DEPLOYED) {
      throw new Error(
        `identityVerifier: no real document verification provider is configured; the placeholder is disabled in ${APP_ENV}`
      );
    }
    if (!data.documentNumber || data.documentNumber.length < 5) {
      return { valid: false, reason: 'Document number too short' };
    }
    return {
      valid: true,
      requiresManualReview: true,
      reason: 'Automated document verification is not implemented in this environment; routed for manual review',
    };
  }
}

export default new IdentityVerifier();
