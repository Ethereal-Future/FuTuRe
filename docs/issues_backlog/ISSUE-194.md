# backend/Dockerfile: Container runs as root user violating container security standards

**Domain:** DevOps & Container Security  
**Complexity:** Medium  
**Labels:** `enhancement`, `security`, `docker`  
**Issue ID:** ISSUE-194

---

## Background
In `backend/Dockerfile`:
The production Dockerfile builds and runs the Node.js application without specifying a `USER` directive.

## Problem
- By default, Docker executes entrypoint processes as `root` (UID 0).
- If an attacker achieves Remote Code Execution (RCE) via a vulnerable dependency or deserialization flaw, they possess root privileges inside the container.
- They can install malicious packages, modify system files, access raw networking sockets, or attempt kernel container breakout attacks.
- Violates CIS Docker Benchmark 4.1 ("Ensure that a user for the container has been created").

## Proposed Solution
1. Utilize the built-in non-root `node` user (UID 1000) or create a dedicated `appuser`.
2. Ensure correct ownership of application files:
```dockerfile
RUN chown -R node:node /app
USER node
```
3. Ensure process runs with minimal Linux capabilities (`cap_drop: ALL`).

## Implementation Steps
1. Add `USER node` directive before `CMD` in `backend/Dockerfile`.
2. Adjust file ownership in build steps.
3. Verify backend container starts and runs healthy as non-root user.

## Acceptance Criteria
- [ ] `docker exec <container> id` reports non-root UID (1000).
- [ ] Application has read-only access to system binaries and write access only to required scratch paths.
- [ ] Passes container security scanning (Trivy / Grype).

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Standard container hardening requirement.

**GitHub Issue:** [1441](https://github.com/Ethereal-Future/FuTuRe/issues/1441)
