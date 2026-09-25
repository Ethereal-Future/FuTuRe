# middleware/idempotency.js: JSON.stringify produces non-deterministic hashes for request bodies with unordered keys, causing false 422 errors

**Domain:** Authentication & Tokens  
**Complexity:** Medium  
**Labels:** `bug`, `middleware`, `api`  
**Issue ID:** ISSUE-075

---

## Background
In `backend/src/middleware/idempotency.js`, requests with an `Idempotency-Key` compute a payload hash (lines 61-63):
```javascript
const cacheKey = `idempotency:${idempotencyKey}`;
const bodyHash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
```
If a client retries a payment with the exact same Idempotency-Key, line 70 checks:
```javascript
if (outcome.mismatch) {
  return res.status(422).json({ error: 'Idempotency-Key used with different request body' });
}
```

## Problem
- Standard JavaScript `JSON.stringify()` serializes object properties in insertion order.
- If a mobile client, web client, or API proxy reorders object keys during serialization:
  - Attempt 1 sends: `{"amount": "100", "destination": "GABC..."}` -> Hash X.
  - Network drops, client library retries sending: `{"destination": "GABC...", "amount": "100"}` -> Hash Y.
- The payloads are semantically 100% identical, but because JSON stringification produces different strings, Hash X != Hash Y.
- The middleware incorrectly flags `outcome.mismatch = true` and returns HTTP 422 Unprocessable Entity, rejecting a valid legitimate retry!

## Proposed Solution
Implement deterministic canonical JSON serialization (RFC 8785 JSON Canonicalization Scheme - JCS) or sort object keys recursively before computing the SHA-256 hash:
```javascript
import canonicalize from 'canonical-json'; // or custom recursive key sorter
const canonicalBody = canonicalize(req.body);
const bodyHash = crypto.createHash('sha256').update(canonicalBody).digest('hex');
```

## Implementation Steps
1. Add a recursive key sorting helper `canonicalJson(obj)` in `backend/src/utils/canonicalJson.js`.
2. Update `bodyHash` calculation in `backend/src/middleware/idempotency.js` to use `canonicalJson(req.body)`.
3. Add unit tests asserting identical hashes for objects with differently ordered keys, nested objects, and arrays.
4. Verify retried requests with shuffled payload keys return the cached idempotent response.

## Acceptance Criteria
- [ ] Payload hashing is deterministic regardless of object key ordering.
- [ ] Identical semantic bodies produce identical SHA-256 hashes.
- [ ] False 422 mismatch errors on legitimate retries are eliminated.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1322](https://github.com/Ethereal-Future/FuTuRe/issues/1322)
