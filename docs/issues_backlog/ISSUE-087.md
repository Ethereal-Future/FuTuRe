# compliance/riskScorer.js: Risk scoring algorithm uses uncalibrated static weights that cannot adapt to evolving transaction patterns or regulatory tiers

**Domain:** Compliance & AML  
**Complexity:** Medium  
**Labels:** `enhancement`, `compliance`, `analytics`  
**Issue ID:** ISSUE-087

---

## Background
In `backend/src/compliance/riskScorer.js`, transaction risk scoring applies static hardcoded weights:
```javascript
const RISK_WEIGHTS = {
  LARGE_TX: 40,
  NEAR_THRESHOLD: 30,
  STRUCTURING: 50,
  VELOCITY: 35,
  RAPID_SUCCESSION: 20,
  UNVERIFIED_USER: 25,
};
```
The score is computed as a simple sum and categorized into LOW (0-30), MEDIUM (31-70), and HIGH (71+).

## Problem
- The weights and thresholds are hardcoded in application code without database or admin configuration.
- A user with a fully verified Tier-3 KYC account receives the exact same risk penalty as an anonymous unverified user for high-velocity transfers.
- Geographical risk (FATF high-risk jurisdictions), counterparty reputation, and account longevity (new account vs 3-year active account) are completely omitted from risk evaluation.
- Regulators require risk-based compliance models to consider customer risk profile, transaction risk, and geographic risk dynamically.

## Proposed Solution
1. Expand risk scoring into a multi-factor matrix:
   - Base Customer Risk (KYC level, account age, jurisdiction FATF rating).
   - Transaction Risk (amount, asset volatility, time of day).
   - Counterparty Risk (DEX counterparty, receiving anchor reputation, smart contract interaction).
2. Allow compliance administrators to tune risk weights via the admin dashboard without redeploying code, persisting weights in `RiskConfiguration` table.
3. Track historical risk score trends per user over time.

## Implementation Steps
1. Create `RiskConfiguration` model in Prisma for dynamic weight management.
2. Refactor `scoreTransaction` in `riskScorer.js` to calculate composite risk across customer, transaction, and counterparty factors.
3. Expose admin endpoint `PUT /api/compliance/risk-config` to adjust scoring weights.
4. Add property tests verifying risk scores remain bounded between 0 and 100.

## Acceptance Criteria
- [ ] Risk scores account for customer KYC tier, jurisdiction, and account age.
- [ ] Compliance staff can adjust risk weights dynamically via admin settings.
- [ ] Audit trail logs any changes to risk calculation rules.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1334](https://github.com/Ethereal-Future/FuTuRe/issues/1334)
