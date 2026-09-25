# compliance/complianceReporting.js: CTR threshold calculation fails to aggregate multiple transactions across related accounts of the same beneficial owner

**Domain:** Compliance & AML  
**Complexity:** Hard  
**Labels:** `bug`, `compliance`, `regulatory`  
**Issue ID:** ISSUE-093

---

## Background
In `backend/src/compliance/complianceReporting.js`, Currency Transaction Report (CTR) aggregation queries transactions grouped strictly by `senderId` (single user ID):
```javascript
const transactions = await prisma.transaction.findMany({
  where: { senderId, createdAt: { gte: dayStart, lte: dayEnd } }
});
```

## Problem
- FinCEN CTR rules (31 CFR § 1010.311) mandate aggregating all cash/crypto transactions conducted by, or on behalf of, the SAME person or beneficial owner across ALL accounts they own or control within a single business day.
- If a business or individual user registers multiple wallets or child accounts (e.g. Personal Account, Business Account, Mobile Wallet) under the same verified identity/tax ID:
  - Account 1 sends $6,000.
  - Account 2 sends $5,000.
  - The total aggregated daily volume is $11,000 (exceeding the $10,000 CTR reporting threshold).
- Because `complianceReporting.js` checks each `senderId` in isolation, neither account hits the $10,000 threshold individually.
- The required regulatory CTR is NEVER generated, resulting in severe regulatory non-compliance.

## Proposed Solution
Aggregate transactions by **Beneficial Owner / Identity** rather than account ID:
1. Link user accounts by tax ID / national identity document (`taxId` or `documentNumberHash` from `KycVerification`).
2. In CTR generation, find all accounts belonging to the same verified identity:
```javascript
const userIds = await getRelatedAccountsByIdentity(identityKey);
const transactions = await prisma.transaction.findMany({
  where: { senderId: { in: userIds }, createdAt: { gte: dayStart, lte: dayEnd } }
});
```
3. If the combined aggregate across all linked accounts exceeds $10,000, generate the CTR reporting all associated accounts.

## Implementation Steps
1. Create helper `getRelatedAccountIds(userId)` in `backend/src/compliance/identityVerifier.js`.
2. Refactor `generateCTR` in `complianceReporting.js` to aggregate across linked beneficial ownership accounts.
3. Add CTR test case with 2 separate accounts belonging to the same KYC document ID sending $6,000 and $5,000, asserting CTR generation.

## Acceptance Criteria
- [ ] CTR threshold evaluation aggregates transactions across all accounts of the same beneficial owner.
- [ ] Cross-account structuring to avoid individual account thresholds is detected.
- [ ] FinCEN multi-account reporting compliance is achieved.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1340](https://github.com/Ethereal-Future/FuTuRe/issues/1340)
