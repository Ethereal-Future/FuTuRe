# routes/recovery.js: Recovery request lookup exposes full list of trusted contact IDs to unauthenticated callers (PII disclosure)

**Domain:** Account Recovery & Custody  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `privacy`  
**Issue ID:** ISSUE-148

---

## Background
In `backend/src/routes/recovery.js`, `GET /api/recovery/:requestId` returns the full status of a recovery request:
```javascript
router.get('/:requestId', async (req, res) => {
  const request = getActiveRequest(req.params.requestId);
  res.json(request);
});
```
`request` contains `userId`, `ipAddress`, `approvals: [contactId1, contactId2]`, and contact metadata.

## Problem
- The endpoint is completely unauthenticated.
- Anyone who knows or guesses a `requestId` (UUID) can view:
  1. The target user's internal ID.
  2. The IP address from which recovery was initiated.
  3. The full list of guardian contact IDs, phone numbers, and email addresses!
- Attackers can use this PII disclosure to identify who the victim's guardians are and launch targeted spear-phishing or SIM-swap attacks against those specific guardians to hijack the account!

## Proposed Solution
1. Require authentication or mask all sensitive fields in public recovery status responses.
2. In `GET /api/recovery/:requestId`, return only sanitized, non-identifying progress metrics:
```javascript
res.json({
  id: request.id,
  status: request.status,
  requiredApprovals: request.requiredApprovals,
  receivedApprovals: request.approvals.length,
  executeAfter: request.executeAfter,
  expiresAt: request.expiresAt,
});
```
3. Never expose guardian contact IDs, names, emails, phone numbers, or IP addresses to public status queries.

## Implementation Steps
1. Sanitize `GET /api/recovery/:requestId` response payload in `routes/recovery.js`.
2. Omit guardian contact details, IP addresses, and user identifiers.
3. Return only aggregate counts (`approvalsCount: 2, required: 3`).
4. Add tests verifying that sensitive guardian PII is absent from response payloads.

## Acceptance Criteria
- [ ] Guardian contact information and IP addresses are not exposed via recovery APIs.
- [ ] Public status queries return only sanitized progress counters.
- [ ] Targeted spear-phishing of guardians via API leakage is prevented.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1395](https://github.com/Ethereal-Future/FuTuRe/issues/1395)
