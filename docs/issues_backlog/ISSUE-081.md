# compliance/rules.js: isStructuring rule flags normal low-value consumer transactions as high-severity structuring, causing false payment blocks

**Domain:** Compliance & AML  
**Complexity:** Hard  
**Labels:** `bug`, `compliance`, `fraud-detection`, `critical-bug`  
**Issue ID:** ISSUE-081

---

## Background
In `backend/src/compliance/rules.js`, the structuring detection rule is implemented as follows (lines 62-68):
```javascript
export function isStructuring(tx, history = []) {
  if (txAmount(tx) >= THRESHOLDS.STRUCTURING) return false;
  const recentSmall = sameSenderInWindow(tx, history, THRESHOLDS.WINDOW_MS).filter(
    (h) => txAmount(h) < THRESHOLDS.STRUCTURING
  );
  return recentSmall.length >= THRESHOLDS.STRUCTURING_COUNT;
}
```
`THRESHOLDS.STRUCTURING` defaults to $1,000, and `THRESHOLDS.STRUCTURING_COUNT` defaults to 3.
In `PRE_SUBMISSION_RULES` (lines 248-252), `isStructuring` is assigned severity `'HIGH'`.
And in `amlMonitor.js` (line 46):
```javascript
blocking: alerts.some(a => a.severity === 'HIGH'),
```

## Problem
- Under this logic, ANY user who executes 3 or more normal low-value transactions (e.g. buying a $3 coffee, sending $10 to a friend, paying $5 for lunch) within 24 hours triggers `recentSmall.length >= 3`.
- The rule flags the user for criminal structuring (smurfing) with severity `HIGH`!
- Because severity is `HIGH`, `amlMonitor.screenTransactionPreSubmission` sets `blocking = true` and BLOCKS THE PAYMENT!
- Real FinCEN anti-structuring regulations define structuring as breaking a large reporting amount (e.g. $10,000) into multiple smaller transactions that aggregate close to or over the reporting threshold (e.g. three $3,300 deposits).
- The current implementation completely ignores cumulative total sum and flags ordinary everyday retail activity as criminal money laundering!

## Proposed Solution
Refactor `isStructuring` to evaluate both transaction count AND cumulative aggregate volume:
1. Filter for transactions that are within a smurfing range (e.g. `amount >= THRESHOLDS.STRUCTURING_LOWER && amount < THRESHOLDS.LARGE_TX`).
2. Sum the cumulative volume of the smurfing transactions plus the current transaction.
3. Only flag `STRUCTURING` if `cumulativeAmount >= THRESHOLDS.LARGE_TX * 0.8` (e.g. total volume across the small transactions is near or exceeds the $10,000 regulatory reporting threshold).
4. Set severity to `MEDIUM` if volume is ambiguous, reserving `HIGH` strictly for clear structuring patterns.

## Implementation Steps
1. Update `isStructuring` in `backend/src/compliance/rules.js` to compute `cumulativeSum` of transactions in the window.
2. Enforce that `cumulativeSum` must exceed `THRESHOLDS.LARGE_TX * 0.85` (or $8,500) before flagging structuring.
3. Verify low-value payments (<$100) are excluded from the smurfing counter unless cumulative volume is significant.
4. Add unit tests with normal consumer micro-transactions ($5, $15, $25) asserting `isStructuring` returns `false`.
5. Add unit tests with real structuring patterns (three $3,200 payments in 12h) asserting `isStructuring` returns `true`.

## Acceptance Criteria
- [ ] Normal retail consumer payments under $1,000 are not blocked as structuring.
- [ ] Legitimate structuring patterns aggregating near the $10,000 FinCEN reporting threshold are accurately flagged.
- [ ] Zero false-positive payment freezes for ordinary everyday users.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1328](https://github.com/Ethereal-Future/FuTuRe/issues/1328)
