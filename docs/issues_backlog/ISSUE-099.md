# webhooks/store.js: Webhook signing secrets are stored in plaintext in PostgreSQL instead of being hashed or encrypted at rest

**Domain:** Webhooks & Delivery  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `webhooks`, `database`  
**Issue ID:** ISSUE-099

---

## Background
In `backend/src/webhooks/store.js`, webhook registrations generate a random HMAC secret:
```javascript
const signingSecret = randomBytes(32).toString('hex');
await prisma.webhook.create({
  data: { accountId, url, events, signingSecret },
});
```
`signingSecret` is stored as a plaintext `String` in PostgreSQL.

## Problem
- A database read leak, read-only SQL injection, or unencrypted database backup exposes the `signingSecret` for every webhook subscriber on the platform.
- With the signing secrets, an attacker can forge webhook events directly to external partner systems (e.g. forging a `PaymentReceived` webhook payload to a merchant), tricking the merchant's server into shipping goods or crediting balances without any real Stellar payment occurring.
- Secrets at rest must be encrypted per security compliance standards.

## Proposed Solution
Encrypt `signingSecret` at rest using `db/encryption.js`:
1. When generating a webhook, encrypt `signingSecret` using `encrypt(signingSecret, WEBHOOK_SECRET_KEY)` before saving to `prisma.webhook`.
2. Return the plaintext `signingSecret` to the user ONCE upon creation.
3. In `dispatcher.js`, decrypt `signingSecret` in-memory only when signing outgoing payloads.

## Implementation Steps
1. Add `WEBHOOK_SECRET_KEY` to environment configuration.
2. Encrypt `signingSecret` in `webhooks/store.js` before database persistence.
3. Decrypt secret in `webhooks/dispatcher.js` prior to HMAC calculation.
4. Create database migration encrypting all existing plaintext signing secrets.
5. Add tests asserting that `signingSecret` in the database is ciphertext.

## Acceptance Criteria
- [ ] Webhook signing secrets are encrypted at rest with AES-256-GCM.
- [ ] Database breaches do not expose usable webhook signing keys.
- [ ] Payload signing functions continue to operate seamlessly.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1346](https://github.com/Ethereal-Future/FuTuRe/issues/1346)
