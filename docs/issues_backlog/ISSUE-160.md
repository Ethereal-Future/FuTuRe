# routes/security.js: Missing RBAC authorization check on emergency playbook trigger endpoint

**Domain:** Security & Authorization  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `critical-bug`, `auth`  
**Issue ID:** ISSUE-160

---

## Background
In `backend/src/routes/security.js`:
Endpoints are provided to trigger automated incident playbooks (such as system isolation, revoking all active user sessions, and freezing outgoing transfers) in response to active attacks.

## Problem
- The route handler for `/api/security/incidents/:id/playbook/execute` validates authentication (`requireAuth`), but fails to verify that the user possesses `SUPER_ADMIN` or `SECURITY_LEAD` role permissions.
- Any standard authenticated user or compromised non-privileged account can trigger emergency playbooks, causing global denial of service, session termination, or transaction freezes across the entire platform!

## Proposed Solution
1. Add `requireRole(['SUPER_ADMIN', 'SECURITY_LEAD'])` middleware to all incident response and playbook execution routes.
2. Require step-up MFA verification (`requireStepUpAuth`) for disruptive incident actions (e.g. system isolation, session revocation).
3. Log all execution attempts to the immutable admin audit log.

## Implementation Steps
1. Update `backend/src/routes/security.js` to enforce strict RBAC on playbook execution endpoints.
2. Add step-up MFA verification requirement for critical incident actions.
3. Add integration test verifying 403 Forbidden for non-admin accounts attempting playbook triggers.

## Acceptance Criteria
- [ ] Non-admin users receive HTTP 403 when attempting to execute playbooks.
- [ ] Incident playbook execution requires explicit elevated permissions and step-up auth.
- [ ] All execution events are written to the audit log.

## Notes
- **Complexity Rating:** Hard
- **Subsystem Notes:** Critical privilege escalation vulnerability.

**GitHub Issue:** [1407](https://github.com/Ethereal-Future/FuTuRe/issues/1407)
