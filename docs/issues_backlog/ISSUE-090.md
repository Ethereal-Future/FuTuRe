# routes/compliance.js: Compliance review decisions (approve/reject/hold) lack mandatory maker-checker dual-authorization workflows

**Domain:** Compliance & AML  
**Complexity:** Hard  
**Labels:** `enhancement`, `compliance`, `security`  
**Issue ID:** ISSUE-090

---

## Background
In `backend/src/routes/compliance.js` and `routes/admin.js`, routes like `PUT /api/admin/kyc/:userId/:action` allow a single administrator or compliance officer to approve KYC verifications, unfreeze held accounts, or dismiss critical AML alerts:
```javascript
router.put('/kyc/:userId/:action', requireAdmin, async (req, res) => {
  const { userId, action } = req.params;
  await updateKycStatus(userId, action);
  res.json({ success: true });
});
```

## Problem
- A single rogue employee or compromised admin credential can unilaterally unfreeze a sanctioned account or approve fraudulent KYC applications without secondary review (single point of failure).
- Financial regulations (FATF Recommendation 18) and enterprise security controls require **Maker-Checker** (Four-Eyes Principle / Dual Authorization) for high-impact compliance decisions.
- Absence of maker-checker controls exposes the platform to internal collusion and rogue operator risk.

## Proposed Solution
Implement a Maker-Checker dual authorization system for sensitive compliance actions:
1. When Officer A submits `approve` or `unfreeze`, create a `ComplianceApprovalRequest` in status `PENDING_REVIEW` (the Maker action).
2. The action is NOT executed until a DIFFERENT compliance officer or supervisor (Officer B) approves it (the Checker action).
3. Enforce `assert(checkerId !== makerId)`.
4. High-risk actions (sanctions override, unfreezing accounts with AML score > 80) require explicit dual sign-off.

## Implementation Steps
1. Create Prisma model `ComplianceApprovalRequest` (`id, action, targetUserId, makerId, checkerId, status, payload, createdAt`).
2. Update admin KYC/AML routes to submit requests into the pending approval queue.
3. Expose endpoints `GET /api/compliance/approvals/pending` and `POST /api/compliance/approvals/:id/approve`.
4. Enforce that maker and checker cannot be the same user ID.
5. Add tests verifying actions remain pending until second officer authorizes.

## Acceptance Criteria
- [ ] High-impact compliance actions require approval from two distinct authorized officers.
- [ ] Single admin cannot unilaterally approve their own requests.
- [ ] Dual-authorization audit trail captures maker and checker identities.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1337](https://github.com/Ethereal-Future/FuTuRe/issues/1337)
