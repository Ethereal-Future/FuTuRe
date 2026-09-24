# webhooks/verifySignature.js: Webhook signature verification uses non-constant-time string comparison, exposing endpoints to timing attacks

**Domain:** Webhooks & Delivery  
**Complexity:** Medium  
**Labels:** `bug`, `security`, `webhooks`, `cryptography`  
**Issue ID:** ISSUE-098

---

## Background
In `backend/src/webhooks/verifySignature.js`:
```javascript
export function verifySignature(payload, signatureHeader, signingSecret) {
  const expectedSignature = signPayload(signingSecret, payload);
  const receivedSignature = signatureHeader.replace(/^sha256=/, '');
  return expectedSignature === receivedSignature;
}
```

## Problem
- Standard JavaScript equality `===` compares strings character-by-character from left to right and returns `false` on the first mismatched byte.
- An attacker can measure the microscopic response time differences (timing attack) to deduce valid signature bytes one by one.
- By submitting thousands of forged requests and analyzing latency histograms, an attacker can forge valid HMAC signatures without knowing `signingSecret`.

## Proposed Solution
Use Node.js's built-in `crypto.timingSafeEqual`:
```javascript
export function verifySignature(payload, signatureHeader, signingSecret) {
  const expectedSignature = signPayload(signingSecret, payload);
  const receivedSignature = signatureHeader.replace(/^sha256=/, '');
  
  if (typeof receivedSignature !== 'string' || receivedSignature.length !== expectedSignature.length) {
    return false;
  }
  
  const expectedBuf = Buffer.from(expectedSignature, 'hex');
  const receivedBuf = Buffer.from(receivedSignature, 'hex');
  
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}
```

## Implementation Steps
1. Update `backend/src/webhooks/verifySignature.js` to use `crypto.timingSafeEqual`.
2. Verify buffer lengths match before calling `timingSafeEqual` to avoid range exceptions.
3. Add unit tests verifying signature verification succeeds for matching signatures and fails safely for mismatched signatures.
4. Verify test coverage for malformed header strings.

## Acceptance Criteria
- [ ] Signature comparison executes in constant time.
- [ ] Timing side-channel vulnerabilities are eliminated.
- [ ] Malformed signature headers reject safely without throwing unhandled exceptions.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1345](https://github.com/Ethereal-Future/FuTuRe/issues/1345)
