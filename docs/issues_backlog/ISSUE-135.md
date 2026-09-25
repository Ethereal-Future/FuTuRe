# mobile/security.js: Mobile root/jailbreak detection payload from client is accepted without server-side cryptographic attestation (Play Integrity / App Attest)

**Domain:** Mobile & Offline Resilience  
**Complexity:** Hard  
**Labels:** `bug`, `mobile`, `security`  
**Issue ID:** ISSUE-135

---

## Background
In `backend/src/mobile/security.js`, client device integrity is verified via an API endpoint:
```javascript
export function verifyDeviceIntegrity(payload) {
  if (payload.isJailbroken || payload.isRooted) {
    return { trusted: false, reason: 'Device is rooted or jailbroken' };
  }
  return { trusted: true };
}
```

## Problem
- The server trusts a simple client-supplied boolean: `{ isJailbroken: false }`!
- On a rooted Android or jailbroken iOS device, any attacker using Frida, Xposed, or a modified APK can simply hook the client-side check and send `{ isJailbroken: false }`.
- Client-asserted booleans provide zero real security against rooted or compromised devices.
- An attacker can run automated bots or malware on compromised devices to exfiltrate private keys while the server believes the device is secure.

## Proposed Solution
Implement genuine server-side cryptographic hardware attestation:
1. For Android: integrate **Google Play Integrity API**. The mobile app requests an integrity token; the backend decrypts and verifies the Google-signed token with Google API, verifying `MEETS_STRONG_INTEGRITY` or `MEETS_DEVICE_INTEGRITY`.
2. For iOS: integrate **Apple App Attest Service**. Verify Apple-signed CBOR attestation statements and assertion counter on the backend.
3. Reject clients that cannot produce valid platform cryptographic attestation for high-value financial operations.

## Implementation Steps
1. Create attestation verification module `backend/src/mobile/attestation.js`.
2. Implement Google Play Integrity token verification using Google API client.
3. Implement Apple App Attest statement verification using Apple public certificates.
4. Enforce hardware attestation on wallet creation and large transfer authorizations.
5. Add mock attestation tests for valid and fraudulent device tokens.

## Acceptance Criteria
- [ ] Device integrity relies on server-verified cryptographic platform attestation.
- [ ] Spoofed client booleans are ignored.
- [ ] Tampered apps and compromised OS environments are reliably detected.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1382](https://github.com/Ethereal-Future/FuTuRe/issues/1382)
