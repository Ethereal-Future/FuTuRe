# mobile/webAuthn.js: Biometric key attestation does not verify authenticator data flags (User Presence and User Verification)

**Domain:** Mobile & Offline Resilience  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `mobile`, `cryptography`  
**Issue ID:** ISSUE-133

---

## Background
In `backend/src/mobile/webAuthn.js`, when verifying an authentication response from a mobile device, the server parses the `authenticatorData` buffer.
`authenticatorData` contains a bitfield of flags:
- Bit 0: User Presence (UP)
- Bit 2: User Verification (UV) (biometric / PIN confirmed)
- Bit 6: Attested Credential Data (AT)
- Bit 7: Extension data (ED)

## Problem
- The verification function checks the cryptographic signature, but DOES NOT verify that the User Verification (UV) flag (bit 2) is set to 1!
- On Android and iOS, if a device is configured with biometrics (FaceID/TouchID), UV flag confirms that the biometric match succeeded.
- Without verifying the UV flag, an authenticator could return an assertion with only User Presence (UP = 1, e.g. clicking "OK") without any biometric verification taking place, completely defeating the biometric re-authentication security guarantee.

## Proposed Solution
Implement strict authenticator data flag verification (W3C WebAuthn Level 3 § 7.2):
```javascript
const flags = authData[32];
const userPresence = (flags & 0x01) !== 0;
const userVerification = (flags & 0x04) !== 0;

if (!userPresence) {
  throw new Error('WebAuthn: User Presence flag not set');
}
if (requireBiometrics && !userVerification) {
  throw new Error('WebAuthn: User Verification flag not set (biometric confirmation required)');
}
```

## Implementation Steps
1. Parse byte 32 of `authenticatorData` in `backend/src/mobile/webAuthn.js`.
2. Verify bit 0 (UP) is set on all authentication assertions.
3. Verify bit 2 (UV) is set when biometric verification is required.
4. Add unit tests with mock authenticator data buffers testing UP=0, UV=0, and valid flags.

## Acceptance Criteria
- [ ] Authenticator data flags are parsed and validated strictly according to W3C spec.
- [ ] Assertions without biometric user verification are rejected on biometric-gated flows.
- [ ] Security unit tests verify flag bitmask parsing.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1380](https://github.com/Ethereal-Future/FuTuRe/issues/1380)
