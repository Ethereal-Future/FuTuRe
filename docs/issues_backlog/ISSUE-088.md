# compliance/identityVerifier.js: Identity document verification does not perform expiration date checks or document tampering analysis

**Domain:** Compliance & AML  
**Complexity:** Medium  
**Labels:** `bug`, `compliance`, `security`  
**Issue ID:** ISSUE-088

---

## Background
In `backend/src/compliance/identityVerifier.js`, document validation inspects format and checksums:
```javascript
export async function verifyDocument(documentData) {
  if (!documentData.number || documentData.number.length < 5) return { valid: false };
  // Stub logic returns verified if number length >= 5
  return { valid: true, confidence: 0.9 };
}
```

## Problem
- The verifier does not check whether the document's expiration date (`expiryDate`) is in the past! Expired passports and driver's licenses are approved without warning.
- Date of birth (`dob`) is not checked to verify the user is of legal age (>= 18 years old).
- Image uploads are not analyzed for MIME type integrity, basic metadata tampering, or resolution quality, allowing corrupted or placeholder images to pass verification.

## Proposed Solution
1. Validate `expiryDate`: enforce `new Date(documentData.expiryDate) > new Date()` (reject expired documents).
2. Validate age: enforce that `dob` indicates age >= 18 years from current date.
3. Validate document number format against country-specific regex patterns (e.g. US passport: 9 digits; UK passport: 9 digits).
4. Integrate with third-party automated identity verification API (e.g. Persona, Onfido, or Sumsub) or mock adapter with full validation rules.

## Implementation Steps
1. Add date validation: check `expiryDate` is in the future.
2. Add age validation: check `dob` confirms applicant is at least 18 years old.
3. Add regex pattern validation for supported document types per issuing nationality.
4. Add unit tests for expired documents, underage applicants, and invalid number formats.

## Acceptance Criteria
- [ ] Expired identity documents are rejected with descriptive validation errors.
- [ ] Underage applicants (<18) are blocked from KYC approval.
- [ ] Document format validation conforms to issuing nation standards.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1335](https://github.com/Ethereal-Future/FuTuRe/issues/1335)
