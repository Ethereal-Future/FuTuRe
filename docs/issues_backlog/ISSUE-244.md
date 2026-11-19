# backend/src/routes/stellar/contract.js: scValFromJson maps all numbers to i64, breaking u32 contract parameters

**Domain:** Backend & Soroban  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `soroban`  
**Issue ID:** ISSUE-244

---

## Background
`backend/src/routes/stellar/contract.js` converts the JSON `args` array of `POST /api/stellar/contract/invoke/build` and `POST /api/stellar/contract/invoke/simulate` into Soroban `ScVal`s through `scValFromJson` (lines 110-120):

```js
function scValFromJson(value) {
  if (typeof value === 'boolean') return StellarSDK.nativeToScVal(value);
  if (typeof value === 'number') return StellarSDK.nativeToScVal(value, { type: 'i128' });
  if (typeof value === 'string' && StellarSDK.StrKey.isValidEd25519PublicKey(value)) {
    return StellarSDK.nativeToScVal(StellarSDK.Address.fromString(value));
  }
  return StellarSDK.nativeToScVal(value);
}
```

Every JSON number becomes one fixed signed integer type. The issue was filed as "i64", but the current code uses `i128`. The bug is the same either way: the caller cannot choose the numeric type.

## Problem
- Soroban checks argument types strictly. A contract function declared as `fn buy_yes(env, market_id: u32, ...)` rejects an `i128` argument. Simulation fails with a host `Value, UnexpectedType` error, and the route returns `422 Simulation failed`.
- Callers cannot invoke any function that takes `u32`, `i32`, `u64`, `u128`, `i64` or `u256`. This covers the market IDs in the prediction-market contract (`stellar-contract/src/lib.rs`).
- JSON numbers above `Number.MAX_SAFE_INTEGER` (2^53 − 1) lose precision before conversion, so large `u64`/`i128` amounts cannot be sent safely as numbers.

## Proposed Solution
Accept explicit type hints and keep the current behaviour as the fallback for untyped values:

```json
{
  "args": [
    { "type": "u32", "value": 7 },
    { "type": "i128", "value": "10000000000" },
    { "type": "address", "value": "GABC..." },
    true
  ]
}
```

- A `{ type, value }` object is converted with `nativeToScVal(value, { type })`. String values are allowed so 64/128/256-bit integers stay exact.
- Plain values keep today's inference, so existing clients keep working.
- Optional follow-up: fetch the contract spec (`contract.Spec` / contract WASM metadata) and coerce untyped args to the declared parameter types.

## Implementation Steps
1. Add an allow-list of supported types: `u32`, `i32`, `u64`, `i64`, `u128`, `i128`, `u256`, `i256`, `bool`, `symbol`, `string`, `bytes`, `address`.
2. Extend `scValFromJson` to recognise `{ type, value }` objects, validate `type` against the allow-list, and range-check integers (for example `u32` must be in 0 … 4294967295).
3. Update `argsValidator` (line 167) so each element is either a primitive or a well-formed typed object, and return `400` with a clear message for unknown types or out-of-range values.
4. Update the Swagger docs for both endpoints to describe typed args.
5. Add unit tests in `backend/tests` that cover each integer width, string-encoded big integers, out-of-range rejection, and the untyped fallback.

## Acceptance Criteria
- [ ] Contract invocation routes support `u32` and `u64` parameter types (and the other integer widths listed above).
- [ ] Soroban contract functions execute without ScVal conversion errors when callers send correctly typed args.
- [ ] Untyped args keep their current behaviour, so existing callers do not break.
- [ ] Invalid type hints or out-of-range values return `400`, not a `422` simulation failure.

## Notes
- **Complexity Rating:** Medium
- The issue title says `i64`; the code currently uses `i128`. The fix is the same.

**GitHub Issue:** [1558](https://github.com/Ethereal-Future/FuTuRe/issues/1558)
