# services/stellar.js: Missing memo length and character validation in transaction builder leads to Horizon malformed transaction errors

**Domain:** Stellar Blockchain Services  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `backend`, `validation`  
**Issue ID:** ISSUE-021

---

## Background
In `backend/src/services/stellar.js`, `sendPayment` accepts `memo` and `memoType` parameters (lines 352-370):
```javascript
if (memo) {
  let stellarMemo;
  switch (memoType) {
    case 'id':
      stellarMemo = StellarSDK.Memo.id(memo);
      break;
    case 'hash':
      stellarMemo = StellarSDK.Memo.hash(memo);
      break;
    case 'return':
      stellarMemo = StellarSDK.Memo.return(memo);
      break;
    case 'text':
    default:
      stellarMemo = StellarSDK.Memo.text(memo);
      break;
  }
  txBuilder.addMemo(stellarMemo);
}
```

## Problem
- Stellar limits `MEMO_TEXT` to a maximum of 28 bytes in UTF-8. Non-ASCII characters (e.g. emojis or Cyrillic/Arabic characters) can easily exceed 28 bytes even if the string character count is <= 28.
- For `memoType === 'id'`, Stellar requires an unsigned 64-bit integer. Passing an alphanumeric string or negative number throws an unhandled exception inside StellarSDK.
- For `memoType === 'hash'` or `'return'`, Stellar requires exactly a 32-byte hex string or Buffer. Passing an invalid hex string throws an uncaught error.
- Callers submitting invalid memos experience 500 internal server errors instead of clean 400 Bad Request validation errors.

## Proposed Solution
Implement strict memo validation before calling `StellarSDK.Memo.*`:
- For `text`: check `Buffer.byteLength(memo, 'utf8') <= 28`.
- For `id`: check that `memo` is a valid string representation of a positive 64-bit unsigned integer (`BigInt(memo) >= 0n && BigInt(memo) <= 18446744073709551615n`).
- For `hash` and `return`: check `/^[0-9a-fA-F]{64}$/.test(memo)`.
Throw a structured `ValidationError` with HTTP 400 status if validation fails.

## Implementation Steps
1. Create `validateMemo(memo, memoType)` helper function.
2. Call `validateMemo` at the beginning of `sendPayment` before building transaction.
3. Return descriptive error messages (e.g. 'MEMO_TEXT exceeds 28 bytes limit').
4. Add comprehensive unit tests for UTF-8 multibyte characters, oversized IDs, and invalid hex hashes.

## Acceptance Criteria
- [ ] Memos exceeding byte limits or with invalid formats are rejected with 400 Bad Request.
- [ ] UTF-8 multibyte byte length is checked instead of string length.
- [ ] SDK crashes on invalid memo inputs are prevented.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1268](https://github.com/Ethereal-Future/FuTuRe/issues/1268)
