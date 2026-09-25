# db/encryption.js: Encrypted field search requires full-table client-side decryption due to absence of blind index or HMAC search tokens

**Domain:** Database & Persistence  
**Complexity:** Hard  
**Labels:** `enhancement`, `database`, `security`, `performance`  
**Issue ID:** ISSUE-066

---

## Background
In `backend/src/compliance/kycCollector.js` and `backend/src/recovery/contactManager.js`, sensitive user data like document numbers, tax IDs, and phone numbers are encrypted with AES-256-GCM. Because GCM uses a random IV for every write, identical plaintexts produce completely different ciphertexts.

## Problem
- When compliance officers search for an applicant by document number or when account recovery searches for a contact by phone number, SQL equality checks (`WHERE document_number = ...`) are impossible.
- The system is forced to fetch ALL records from the database into Node memory, decrypt every single record sequentially, and compare in JavaScript!
- As user records grow to tens of thousands, searching by document or phone takes seconds, consumes gigabytes of RAM, and threatens to crash the Node process with Out-of-Memory (OOM).

## Proposed Solution
Implement a Blind Index (HMAC Search Token) pattern (per NIST cryptographic guidelines):
1. Compute a deterministic search hash: `blindIndex = crypto.createHmac('sha256', BLIND_INDEX_KEY).update(normalizedPlaintext).digest('hex')`.
2. Store `blindIndex` in a dedicated indexed column (e.g. `documentNumberHash`).
3. To search, compute the HMAC of the search input and execute `WHERE document_number_hash = $blindIndex`.
4. The database uses the index to return the single matching record in 1ms without decrypting the entire table.

## Implementation Steps
1. Add `generateBlindIndex(plaintext, salt)` in `backend/src/db/encryption.js`.
2. Add `documentNumberHash` column to `KycVerification` and `phoneHash` to `RecoveryContact` in `prisma/schema.prisma`.
3. Populate blind indexes upon creation and update.
4. Refactor search queries in `compliance` and `recovery` routes to query by blind index.
5. Add performance tests asserting O(1) index lookup time on 10,000 encrypted records.

## Acceptance Criteria
- [ ] Searching encrypted fields executes via indexed SQL lookups in <5ms.
- [ ] Full-table in-memory decryption scans are eliminated.
- [ ] Blind index HMAC key is segregated from encryption keys.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1313](https://github.com/Ethereal-Future/FuTuRe/issues/1313)
