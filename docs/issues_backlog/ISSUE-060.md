# db/encryption.js: AES-256-GCM column encryption lacks key rotation metadata and initialization vector (IV) uniqueness enforcement

**Domain:** Database & Persistence  
**Complexity:** Hard  
**Labels:** `bug`, `database`, `security`, `cryptography`  
**Issue ID:** ISSUE-060

---

## Background
In `backend/src/db/encryption.js`, sensitive fields (PII, recovery secrets, webhook secrets) are encrypted using AES-256-GCM:
```javascript
export function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}
```

## Problem
- The ciphertext format `${iv}:${authTag}:${encrypted}` does not include a `key_version` / key ID prefix (e.g. `v1:iv:tag:ciphertext`).
- If `STREAM_SECRET_ENCRYPTION_KEY` or `BACKUP_ENC_KEY` is rotated (as required by security compliance policies every 90 days), all existing database rows encrypted with the previous key immediately fail decryption with `Unsupported state or unable to authenticate data`.
- There is no automated re-encryption script or key version discriminator to support seamless key rotation without downtime.
- In addition, there is no key derivation function (PBKDF2/Argon2) applied if the key is provided as a human-readable string.

## Proposed Solution
1. Update ciphertext envelope format to `v${keyVersion}:${iv}:${authTag}:${ciphertext}`.
2. Support multiple active keys in configuration: a `currentKeyId` for new writes and a `keyRing` mapping key IDs to secrets for reads.
3. In `decrypt(ciphertext, keyRing)`, extract `keyVersion`, select the matching key from `keyRing`, and decrypt.
4. Implement a migration utility `reencryptTable(model, fields, oldKeyId, newKeyId)` to migrate records in the background.

## Implementation Steps
1. Refactor `db/encryption.js` to prepend key version to encrypted strings.
2. Update `decrypt` to parse version prefix and support multi-key keyring.
3. Create CLI utility `npm run db:rotate-encryption-keys` to re-encrypt existing records.
4. Add tests verifying decryption of older key versions and re-encryption to latest version.

## Acceptance Criteria
- [ ] Encrypted records include explicit key version metadata.
- [ ] Key rotation does not break decryption of historical records.
- [ ] Background re-encryption migration utility is provided.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1307](https://github.com/Ethereal-Future/FuTuRe/issues/1307)
