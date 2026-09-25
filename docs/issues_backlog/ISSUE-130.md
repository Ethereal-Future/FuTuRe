# mobile/offlineQueue.js: Queue flush does not resolve Stellar sequence number conflicts between offline-queued transactions and live account state

**Domain:** Mobile & Offline Resilience  
**Complexity:** Hard  
**Labels:** `bug`, `mobile`, `stellar`, `concurrency`  
**Issue ID:** ISSUE-130

---

## Background
In `backend/src/mobile/offlineQueue.js`, when a client reconnects and calls `/mobile/queue/flush`, the server iterates through the queued transactions and submits them to Stellar in FIFO order.
While offline, transactions were built and signed with sequence numbers assumed by the client device.

## Problem
- If the user made ANY transaction from another device (e.g. web wallet) or if an incoming claimable balance was claimed while the mobile app was offline, the on-chain sequence number has advanced.
- When the offline queue is flushed:
  - Transaction 1 has an obsolete sequence number and fails with `tx_bad_seq`.
  - Because transaction 1 failed, subsequent transactions in the queue (which depend on transaction 1's sequence number) are stalled or also fail.
- There is no automated re-sequencing, pre-flight check, or signature re-prompt mechanism for offline transaction batches.

## Proposed Solution
1. In `flushQueue`, fetch the current live on-chain sequence number from Horizon before submitting.
2. If sequence drift is detected, check if the transactions were signed client-side or if they are unsigned transaction intents:
   - For signed XDRs that cannot be re-sequenced without a new signature, mark the queue item as `SEQUENCE_MISMATCH` and return a structured response to the mobile app prompting the user for a batch re-signature.
   - For server-signed delegated payments, update the sequence number to match the current ledger sequence and submit sequentially.

## Implementation Steps
1. Add pre-flight sequence verification in mobile queue flush handler.
2. Differentiate signed client XDRs from unsigned payment intents.
3. Provide mobile API response with exact sequence drift details and re-sign payloads.
4. Add integration test simulating sequence drift and verifying clear error prompting.

## Acceptance Criteria
- [ ] Sequence number drift during offline periods is detected before Horizon submission.
- [ ] Clients receive clear re-sign prompts rather than cryptic `tx_bad_seq` failures.
- [ ] Queue processing does not halt permanently on sequence conflicts.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1377](https://github.com/Ethereal-Future/FuTuRe/issues/1377)
