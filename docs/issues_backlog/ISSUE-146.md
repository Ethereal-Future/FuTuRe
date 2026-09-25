# recovery/recoveryAudit.js: Recovery audit trail writes directly to unmonitored files without security team alerting for account takeovers

**Domain:** Account Recovery & Custody  
**Complexity:** Medium  
**Labels:** `enhancement`, `security`, `observability`, `compliance`  
**Issue ID:** ISSUE-146

---

## Background
In `backend/src/recovery/recoveryAudit.js`, recovery events (`RECOVERY_INITIATED`, `ATTEMPT_FAILED`, `RECOVERY_COMPLETED`) are appended to a local log file `backend/data/recovery-audit.log`.

## Problem
- An account recovery initiation is the highest-risk security event in the application lifecycle (frequently associated with SIM swaps, social engineering, and credential compromise).
- Appending to a local log file means security teams receive zero real-time alerts when an account recovery is started.
- The legitimate account owner is not alerted via emergency channels (push, SMS, email) that someone has initiated account recovery on their wallet.
- If an attacker initiates recovery, the owner has no idea until the 24-hour time-lock expires and they are locked out.

## Proposed Solution
1. When `RECOVERY_INITIATED` occurs, immediately broadcast high-priority emergency alerts across ALL registered channels for that user (email, SMS, push notification):
   "SECURITY ALERT: Account recovery was initiated from IP ${ipAddress}. If this was not you, click here immediately to CANCEL and FREEZE your account."
2. Send real-time webhook alerts to the security operations team (Slack/PagerDuty/SIEM).
3. Persist audit records to `ComplianceAuditLog` in PostgreSQL with structured metadata.

## Implementation Steps
1. Integrate `notificationService.sendEmergencyAlert` in `initiateRecovery`.
2. Add direct one-click cancellation link with signed token in emergency emails.
3. Publish recovery events to SIEM / OpenTelemetry metrics.
4. Add tests verifying emergency notifications are dispatched upon recovery initiation.

## Acceptance Criteria
- [ ] Account owners receive immediate emergency alerts across all channels when recovery is initiated.
- [ ] One-click cancellation allows victims to abort unauthorized recovery immediately.
- [ ] Security operations receive real-time alerting for all recovery events.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1393](https://github.com/Ethereal-Future/FuTuRe/issues/1393)
