# mobile/webAuthn.js: WebAuthn challenge generation does not bind challenges to user sessions with short TTLs, risking replay attacks

**Domain:** Mobile & Offline Resilience  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `mobile`, `cryptography`  
**Issue ID:** ISSUE-132

---

## Background
In `backend/src/mobile/webAuthn.js`, WebAuthn registration and authentication challenges are generated:
```javascript
export function generateChallenge() {
  return crypto.randomBytes(32).toString('base64url');
}
```
The challenge is returned to the mobile app, but is either stored in a simple global Map or returned statelessly without cryptographic session binding.

## Problem
- If a challenge is not bound to a specific authenticated user session ID and stored with a short TTL (e.g. 60 seconds):
  1. An attacker can harvest valid challenges and reuse them across different user accounts.
  2. If the challenge verification does not immediately consume/delete the challenge upon first verification, a recorded authentication assertion can be replayed.
  3. WebAuthn Level 3 specifications strictly require that challenges be cryptographically random, single-use, session-bound, and time-limited.

## Proposed Solution
Store challenges in Redis with session binding and immediate consumption:
1. When generating a challenge:
   `await redis.set("webauthn:challenge:" + sessionId, challenge, "EX", 60);`
2. During verification:
   - Retrieve stored challenge: `const stored = await redis.get("webauthn:challenge:" + sessionId);`
   - Assert `stored === receivedChallenge`.
   - Immediately delete the challenge from Redis (`redis.del(...)`) to guarantee single-use.
   - If challenge is missing or expired, reject with 401 `ChallengeExpired`.

## Implementation Steps
1. Refactor `backend/src/mobile/webAuthn.js` to store challenges in Redis keyed by `sessionId`.
2. Enforce 60-second TTL on all WebAuthn challenges.
3. Implement atomic delete-on-read to prevent replay attacks.
4. Add tests asserting that replaying an assertion with the same challenge fails.

## Acceptance Criteria
- [ ] WebAuthn challenges are bound to user session IDs.
- [ ] Challenges expire after 60 seconds.
- [ ] Challenges can only be used once (replay protection).

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1379](https://github.com/Ethereal-Future/FuTuRe/issues/1379)
