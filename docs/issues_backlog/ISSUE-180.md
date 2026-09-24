# frontend/components/AddressBook.jsx: Missing client-side Stellar address checksum validation allows saving invalid recipients

**Domain:** Frontend & Validation  
**Complexity:** Medium  
**Labels:** `bug`, `frontend`, `stellar`, `validation`  
**Issue ID:** ISSUE-180

---

## Background
In `frontend/src/components/AddressBook.jsx`:
Users can add contacts by typing a name and a Stellar public key (G... address) or federation address (user*domain.com).

## Problem
- The input form only checks `address.startsWith('G') && address.length === 56`.
- It does not validate the ed25519 public key base32 CRC16 checksum (`StrKey.isValidEd25519PublicKey(address)`).
- If a user accidentally types a single wrong character (e.g. typo during manual entry), the address is saved successfully into their address book.
- When they subsequently send funds to this contact, transactions fail with `tx_bad_auth` or invalid operation, or worse, if checksum was not checked by custom tools, funds could be sent to an unrecoverable burn key.

## Proposed Solution
1. Import `StrKey` from `@stellar/stellar-sdk` in `AddressBook.jsx`.
2. Validate using `StrKey.isValidEd25519PublicKey(address)` or resolve federation addresses via Stellar Federation Server.
3. Highlight invalid characters and show checksum validation status in real time as the user types.

## Implementation Steps
1. Update address validation in `frontend/src/components/AddressBook.jsx` to use `StrKey.isValidEd25519PublicKey`.
2. Add federation address format checking (`user*domain.com`).
3. Add unit tests for invalid checksums and truncated keys.

## Acceptance Criteria
- [ ] Address book rejects public keys with invalid CRC16 checksums.
- [ ] Valid ed25519 keys and federation addresses are accepted.
- [ ] Clear validation error indicates exact reason for rejection.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Prevents user error and failed payments.

**GitHub Issue:** [1427](https://github.com/Ethereal-Future/FuTuRe/issues/1427)
