# services/multiSig.js: Multi-sig transactions expire due to sequence number advance if source account transacts prior to final submission

**Domain:** Multi-Sig & Authorization  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `resilience`, `architecture`  
**Issue ID:** ISSUE-033

---

## Background
In `backend/src/services/multiSig.js`, `buildMultiSigTransaction` creates a transaction and pins the sequence number at creation time (lines 106-125):
```javascript
const sourceAccount = await withHorizonRetry(() => getHorizonServer().loadAccount(sourcePublicKey));
const transaction = new StellarSDK.TransactionBuilder(sourceAccount, {
  fee: StellarSDK.BASE_FEE,
  networkPassphrase: getNetworkPassphrase(),
}).addOperation(...).setTimeout(300).build();
```
`transaction` is converted to XDR and stored in `pendingMultiSigTx`.

## Problem
- A multi-sig transaction often takes hours or days to gather signatures from multiple human signers or organizational officers.
- If the source account executes ANY on-chain transaction in the interim (e.g. paying a fee, receiving/managing a trustline, or executing an unrelated transfer), the on-chain sequence number advances.
- Because the pending transaction XDR has the old sequence number hardcoded into its signature payload, the transaction can NEVER be submitted to Stellar—it will permanently fail with `tx_bad_seq`.
- All signatures gathered up to that point become invalid, requiring the entire process to be restarted from scratch.

## Proposed Solution
1. Support Stellar Fee-Bump or Channel Accounts for multi-sig submissions: build transactions with dedicated channel accounts or fee-bump wrappers so the primary account sequence is decoupled.
2. Implement pre-flight sequence checking in `submitMultiSigTransaction`: if sequence mismatch is detected, notify signers and provide a one-click re-sign workflow.
3. In `buildMultiSigTransaction`, use `minSequenceNumber` or `bumpSequence` operations where applicable, and increase the transaction timebound to match organizational SLA (e.g. 7 days instead of 300 seconds).

## Implementation Steps
1. Increase default multi-sig timebound from 300 seconds (5 mins) to a configurable duration (default 7 days).
2. Add sequence monitoring: query current source sequence and alert users if pending transactions are endangered.
3. Support channel accounts as the transaction source account while operations target the multi-sig account.
4. Add unit tests verifying sequence expiration detection.

## Acceptance Criteria
- [ ] Timebound is configurable and defaults to realistic multi-day collection windows.
- [ ] Source account sequence drift is detected with clear error messaging.
- [ ] Channel account support prevents unrelated account activity from invalidating pending multi-sig transactions.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1280](https://github.com/Ethereal-Future/FuTuRe/issues/1280)
