# recovery/recoveryWorkflow.js: Mandatory 24-hour recovery time-lock can be bypassed by manipulating server process clock or re-initiating requests

**Domain:** Account Recovery & Custody  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `critical-bug`  
**Issue ID:** ISSUE-145

---

## Background
In `backend/src/recovery/recoveryWorkflow.js`, time-lock enforcement compares the current date against `executeAfter`:
```javascript
if (new Date() < new Date(request.executeAfter)) {
  const remaining = Math.ceil((new Date(request.executeAfter) - new Date()) / 3600000);
  throw new Error(`Time-lock active. ${remaining}h remaining...`);
}
```
`executeAfter` is computed using `Date.now()` on the local server process.

## Problem
- Local server clock drift (NTP desynchronization) can cause premature maturation of the time-lock.
- If a user cancels a recovery request, but an attacker immediately calls `initiateRecovery` again while holding guardian tokens, or if database transactions race, the time-lock check can be subverted.
- The time-lock does not record the blockchain ledger sequence or public time authority (e.g. Roughtime / Stellar ledger close time).
- A malicious administrator or attacker with host access can set the server system clock forward by 24 hours to instantly bypass the time-lock and hijack any pending account!

## Proposed Solution
1. Base time-lock evaluation on the **Stellar ledger close time** (`env.ledger().timestamp()` or Horizon `/ledgers` timestamp) rather than volatile local system clock `new Date()`.
2. Anchor the recovery initiation event to the Stellar ledger via an on-chain transaction memo or `manageData` entry.
3. Require `currentLedgerTime >= initiatedLedgerTime + 24 * 3600` before `completeRecovery` can be executed.
4. Local clock manipulation cannot subvert blockchain consensus time.

## Implementation Steps
1. Fetch authoritative ledger close time from `getHorizonServer().ledgers().order('desc').limit(1).call()`.
2. Store `initiatedLedgerSequence` and `initiatedLedgerTimestamp` on recovery records.
3. Enforce that completion checks compare against the latest closed ledger timestamp.
4. Add test verifying that manipulating process system clock cannot bypass ledger-anchored time-locks.

## Acceptance Criteria
- [ ] Recovery time-lock is anchored to decentralized Stellar ledger timestamps.
- [ ] Local server clock drift or tampering cannot bypass the 24-hour security delay.
- [ ] Account owners are guaranteed a full 24 hours to contest unauthorized recoveries.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1392](https://github.com/Ethereal-Future/FuTuRe/issues/1392)
