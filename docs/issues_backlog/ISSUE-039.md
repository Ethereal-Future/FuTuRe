# services/multiSig.js: Pending multi-sig transactions lack webhook or push notification dispatch when new signatures are required or added

**Domain:** Multi-Sig & Authorization  
**Complexity:** Medium  
**Labels:** `enhancement`, `stellar`, `notifications`  
**Issue ID:** ISSUE-039

---

## Background
When a multi-sig transaction is built in `buildMultiSigTransaction`, it publishes an event to `eventMonitor`:
```javascript
await eventMonitor.publishEvent(sourcePublicKey, {
  type: 'MultiSigTransactionBuilt',
  data: { txId, destination, amount, assetCode },
  version: 1,
});
```
However, this event is only published to the internal event sourcing engine and is never routed to the notification service, webhooks, or push notifications for other signers.

## Problem
- When Co-Signer A creates a multi-sig payment, Co-Signer B and Co-Signer C receive zero notification that a transaction is waiting for their signature.
- Co-Signer B has to be told out-of-band (via Slack/Telegram/email) or manually poll the dashboard to know that a signature is required.
- If transactions expire in 5 minutes or hours, signers miss the window entirely, causing payment delays and transaction timeouts.

## Proposed Solution
Integrate with `backend/src/notifications/service.js` and `webhooks/dispatcher.js`:
1. On `MultiSigTransactionBuilt`, look up all designated signers on the account.
2. Dispatch an email, web push, and in-app notification to each signer: `"Payment of ${amount} ${assetCode} requires your signature"` with a direct deep-link to the signing modal.
3. On `MultiSigTransactionSigned`, notify the transaction creator that a new signature was collected.

## Implementation Steps
1. Query user profiles corresponding to all account signers in `buildMultiSigTransaction`.
2. Trigger `notificationService.sendNotification(signerUserId, 'multisig_signature_required', { ... })`.
3. Dispatch webhook event `multisig.signature_required` for API subscribers.
4. Add notification template `multisig_signature_required` in `notifications/templates.js`.
5. Add tests verifying notifications dispatched upon transaction creation.

## Acceptance Criteria
- [ ] All signers receive push/email notification when a multi-sig transaction is pending their signature.
- [ ] Deep-link directs signers directly to the signing confirmation screen.
- [ ] Webhooks dispatch `multisig.signature_required` events.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1286](https://github.com/Ethereal-Future/FuTuRe/issues/1286)
