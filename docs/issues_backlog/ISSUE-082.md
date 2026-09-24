# compliance/amlMonitor.js: screenTransaction alert persistence silently swallows database errors (.catch(() => {})), dropping AML audit records

**Domain:** Compliance & AML  
**Complexity:** Medium  
**Labels:** `bug`, `compliance`, `database`, `audit`  
**Issue ID:** ISSUE-082

---

## Background
In `backend/src/compliance/amlMonitor.js`, asynchronous post-submission screening persists alerts to the database (lines 65-79):
```javascript
if (tx.id && tx.senderId) {
  await Promise.all(alerts.map(alert =>
    prisma.aMLAlert.create({
      data: {
        transactionId: tx.id,
        userId:        tx.senderId,
        ruleId:        alert.ruleId,
        severity:      alert.severity,
        description:   alert.description,
        riskScore:     riskScore.score ?? 0,
        riskLevel:     riskScore.level ?? 'UNKNOWN',
      },
    }).catch(() => {}) // don't fail the payment if alert persistence fails
  ));
}
```

## Problem
- When database errors occur (e.g. transient connection timeout, foreign key violation, or database pool saturation), the alert creation silently fails with `.catch(() => {})`.
- The error is not logged, no alert is raised to the security team, and the AML alert record is permanently lost from the database.
- Bank Secrecy Act (BSA) and anti-money laundering regulations mandate complete, durable retention of all AML monitoring alerts.
- Dropping alerts silently creates severe regulatory non-compliance liability during banking audits.

## Proposed Solution
1. Log any alert persistence failure with high severity: `logger.error({ err, alert, txId: tx.id }, 'compliance.aml_alert.persist_failed')`.
2. Write failed alerts to a durable Dead Letter Queue (DLQ) in Redis (`compliance:alerts:dlq`) or a fallback audit file.
3. Implement a retry worker that processes the DLQ and re-inserts failed alert records once database connectivity is restored.
4. Emit a critical metric `aml_alert_persistence_failures_total`.

## Implementation Steps
1. Remove empty `.catch(() => {})` in `backend/src/compliance/amlMonitor.js`.
2. Implement fallback persistence to Redis list `compliance:dlq:alerts` on database write failure.
3. Log structured error with transaction ID, rule ID, and failure reason.
4. Add a scheduled retry worker in `backend/src/scheduler.js` to drain the DLQ into PostgreSQL.
5. Add unit tests verifying DLQ storage when Prisma throws an error.

## Acceptance Criteria
- [ ] AML alerts are never silently dropped on database errors.
- [ ] Failed alert writes are captured in a durable Redis DLQ for automated retry.
- [ ] Structured error logs and metrics trigger operational alerts.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1329](https://github.com/Ethereal-Future/FuTuRe/issues/1329)
