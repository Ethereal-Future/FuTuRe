# compliance/kycCollector.js: PII encryption at rest does not segregate KYC documents into a dedicated zero-knowledge compliance vault

**Domain:** Compliance & AML  
**Complexity:** Hard  
**Labels:** `bug`, `compliance`, `security`, `privacy`  
**Issue ID:** ISSUE-085

---

## Background
In `backend/src/compliance/kycCollector.js`, KYC identity documents (passports, national ID cards, proof of address) are stored either as base64 strings in PostgreSQL or as files on disk encrypted with the standard application key `STREAM_SECRET_ENCRYPTION_KEY` or `BACKUP_ENC_KEY`.

## Problem
- Personally Identifiable Information (PII) and sensitive biometric identity documents are stored in the same database and access tier as operational transaction logs and user profiles.
- Any backend service with standard database access can query and decrypt full user passport numbers, dates of birth, and home addresses (violating GDPR Article 25 Privacy by Design and Principle of Least Privilege).
- A database leak exposes full identity theft packages for all registered users.

## Proposed Solution
1. Segregate PII and identity documents into a dedicated zero-knowledge compliance vault table (`KycVaultDocument`).
2. Encrypt KYC documents using a dedicated compliance encryption key (`KYC_ENCRYPTION_KEY`) managed via AWS KMS / HashiCorp Vault with restricted IAM policies accessible only to compliance services.
3. Redact PII in standard API responses: only compliance officers with specific `ROLE_COMPLIANCE` can decrypt full document images.
4. Maintain an immutable audit log whenever any user PII is decrypted and viewed.

## Implementation Steps
1. Provision `KYC_ENCRYPTION_KEY` in AWS Secrets Manager / KMS in `infra/secrets.tf`.
2. Migrate KYC document storage to dedicated encrypted storage with envelope encryption.
3. Restrict decryption privileges strictly to `requireComplianceRole` middleware.
4. Log all PII access events to `complianceAudit` with admin ID, user ID, timestamp, and purpose.
5. Add tests verifying regular users and standard admins cannot decrypt KYC identity documents.

## Acceptance Criteria
- [ ] KYC PII is encrypted with an isolated dedicated key.
- [ ] Only authenticated compliance staff can decrypt identity documents.
- [ ] Every decryption access event generates a tamper-evident audit record.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1332](https://github.com/Ethereal-Future/FuTuRe/issues/1332)
