# security/mfa.js: Silent fallback on decryption failure corrupts MFA validation flow

**Domain:** Security & MFA  
**Complexity:** Medium  
**Labels:** `bug`, `security`, `crypto`  
**Issue ID:** ISSUE-157

---

## Background
In `backend/src/security/mfa.js` (lines 24-33):
```javascript
  decryptField(value) {
    if (!value) return value;
    try {
      return decryptFromEnvValue(value, this.getEncryptionKey());
    } catch (err) {
      logger.error({ err }, 'Failed to decrypt MFA field');
      return value; // return as-is if decryption fails
    }
  }
```
When decryption of an encrypted MFA secret fails (e.g. key rotation mismatch, corrupted ciphertext), the raw ciphertext string is returned as-is.

## Problem
- If decryption fails, returning raw ciphertext allows the application to proceed with an invalid secret.
- In `verifyToken(userId, token)`:
  - `speakeasy.totp.verify({ secret: ciphertext, ... })` receives unpadded corrupted base32 or hex strings.
  - Speakeasy throws unhandled decoding exceptions or returns false without giving clear diagnostics.
- The user is permanently locked out of MFA verification without any alert being surfaced to admins indicating key decryption failure.

## Proposed Solution
1. Do NOT return ciphertext as-is on decryption failure.
2. Throw an explicit `DecryptionError` or return `null` and handle it as a security exception.
3. Emit a critical security alert so operators know the encryption key does not match user records.

## Implementation Steps
1. Update `decryptField` in `backend/src/security/mfa.js` to throw `CryptographicError` on failure.
2. Add structured error handling in caller functions (`verifyToken`, `enableMFA`).
3. Add test verifying error propagation when encryption key is altered.

## Acceptance Criteria
- [ ] Corrupted or undecryptable MFA fields fail fast with explicit security exceptions.
- [ ] Raw ciphertext is never passed into TOTP validation engines.
- [ ] Critical alert is logged for operational triage.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Prevents silent failure and difficult-to-diagnose user lockouts.

**GitHub Issue:** [1404](https://github.com/Ethereal-Future/FuTuRe/issues/1404)
