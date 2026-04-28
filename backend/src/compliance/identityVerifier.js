import kycCollector, { KYC_STATUS } from './kycCollector.js';
import sanctionsChecker from './sanctionsChecker.js';

// Simulates integration with an identity verification provider (e.g. Jumio, Onfido).
// In production, replace _callProvider with actual API calls.
class IdentityVerifier {
  async verify(userId) {
    const record = await kycCollector.getKYCRecord(userId);
    if (!record) throw new Error(`No KYC submission found for user ${userId}`);

    // 1. Sanctions check
    const sanctioned = await sanctionsChecker.check(record.fullName, record.nationality);
    if (sanctioned.hit) {
      await kycCollector.updateStatus(userId, KYC_STATUS.REJECTED, `Sanctions match: ${sanctioned.reason}`);
      return { verified: false, reason: 'sanctions_hit', detail: sanctioned.reason };
    }

    // 2. Document validation (stub — replace with real provider)
    const docResult = await this._callProvider(record);
    if (!docResult.valid) {
      await kycCollector.updateStatus(userId, KYC_STATUS.REJECTED, `Document invalid: ${docResult.reason}`);
      return { verified: false, reason: 'document_invalid', detail: docResult.reason };
    }

    await kycCollector.updateStatus(userId, KYC_STATUS.APPROVED, 'Identity verified successfully');
    return { verified: true };
  }

  // Stub: always approves valid-looking documents. Replace with real provider SDK.
  async _callProvider(data) {
    if (!data.documentNumber || data.documentNumber.length < 5) {
      return { valid: false, reason: 'Document number too short' };
    }
    return { valid: true };
  }
}

export default new IdentityVerifier();
