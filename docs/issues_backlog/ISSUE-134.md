# mobile/sessions.js: Mobile session store lacks device fingerprint binding and device revocation coordination across concurrent devices

**Domain:** Mobile & Offline Resilience  
**Complexity:** Medium  
**Labels:** `enhancement`, `mobile`, `security`  
**Issue ID:** ISSUE-134

---

## Background
In `backend/src/mobile/sessions.js`, mobile sessions are managed independently of the main web session store. When a user logs in from a mobile device, a session token is issued.

## Problem
- The mobile session is not bound to a device fingerprint (device ID, OS version, app bundle ID).
- If a mobile session token is exfiltrated from device storage or a backup, it can be used on any desktop or other mobile device without detection.
- When a user logs into the web app and clicks "Log out of all devices", mobile sessions managed in `mobile/sessions.js` are not revoked because they live in a disjoint data structure.
- Compromised mobile devices remain logged in indefinitely.

## Proposed Solution
1. Unify mobile and web session management in `prisma.session`.
2. Record `deviceId`, `deviceModel`, `osVersion`, and `appVersion` on the session model.
3. Validate `deviceId` header on every request matching the session token.
4. Ensure `revokeAllSessions` revokes both web and mobile session records in a single coordinated database update.

## Implementation Steps
1. Add `deviceId` and mobile metadata fields to `Session` model in Prisma.
2. Bind mobile session tokens to the requesting `deviceId`.
3. Update `revokeAllSessions` in `auth/sessionStore.js` to revoke all user sessions regardless of platform.
4. Add tests verifying device fingerprint matching on mobile API calls.

## Acceptance Criteria
- [ ] Mobile sessions are bound to unique device hardware identifiers.
- [ ] Session tokens cannot be reused on unrecognized devices.
- [ ] Global logout revokes all mobile and web sessions simultaneously.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1381](https://github.com/Ethereal-Future/FuTuRe/issues/1381)
