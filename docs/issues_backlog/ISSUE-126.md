# services/streaming.js: Stream rate amounts permit fractional micro-stroop amounts that fail Stellar SDK minimum integer amount constraints

**Domain:** Payment Streaming  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `validation`  
**Issue ID:** ISSUE-126

---

## Background
In `backend/src/services/streaming.js`, `createStream` validates `rateAmount` as a basic number:
```javascript
export async function createStream({ senderPublicKey, senderSecret, recipientPublicKey, assetCode, rateAmount, intervalSeconds = 60, ... }) {
```
A user can configure streaming e.g. 0.00000005 XLM per second.

## Problem
- Stellar consensus enforces a minimum indivisible unit of 1 stroop (0.0000001 / 1e-7).
- If a user inputs a `rateAmount` with more than 7 decimal places (e.g. `0.00000001` or `0.000000005`), `StellarSDK.Operation.payment` throws `Error: amount must have at most 7 digits of precision`.
- The stream is successfully created in the database, but every subsequent worker execution tick fails permanently on Stellar SDK validation!
- The stream fails immediately without sending a single payment.

## Proposed Solution
Validate `rateAmount` strictly at creation time:
1. Enforce that `rateAmount` has at most 7 decimal places:
```javascript
if (!/^\d+(\.\d{1,7})?$/.test(String(rateAmount))) {
  throw new Error('rateAmount cannot exceed 7 decimal places (1 stroop)');
}
```
2. Enforce a sensible minimum payment amount per interval: `parseFloat(rateAmount) >= 0.00001` (to prevent dusting transactions and avoid paying more in network fees than the transferred value).

## Implementation Steps
1. Add regex and minimum amount validation in `createStream` in `services/streaming.js`.
2. Add validation middleware in `routes/streaming.js`.
3. Add unit tests for valid 7-decimal amounts and invalid 8+ decimal amounts.
4. Reject sub-stroop amounts with 400 Bad Request.

## Acceptance Criteria
- [ ] Stream rate amounts with >7 decimal places are rejected at creation time.
- [ ] Streams cannot be created with amounts that fail Stellar SDK validation.
- [ ] Clear error messages guide users on minimum precision limits.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1373](https://github.com/Ethereal-Future/FuTuRe/issues/1373)
