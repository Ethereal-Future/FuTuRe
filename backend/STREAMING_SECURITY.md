# Streaming Payment Security

## Per-Stream Secret Implementation

As an interim improvement before full delegated signing, the streaming worker now uses per-stream secrets stored encrypted at rest in the database.

### Architecture

- Each `PaymentStream` has an encrypted `senderSecret` field
- Secrets are encrypted using `STREAM_SECRET_ENCRYPTION_KEY` environment variable
- The streaming worker decrypts secrets only when processing payments
- Decrypted secrets are never persisted to disk or logs

### Security Trade-offs

#### Current Implementation (Per-Stream Secrets)

**Advantages:**
- Each stream can use a different sender's secret
- Enables multi-user streaming scenarios
- Secrets are encrypted at rest in the database
- Reduces blast radius if one stream's secret is compromised

**Disadvantages:**
- Secrets must be decrypted in application memory during payment processing
- If the application is compromised, all decrypted secrets in memory are at risk
- Encryption key (`STREAM_SECRET_ENCRYPTION_KEY`) is a single point of failure
- Requires secure key management and rotation procedures

#### Previous Implementation (Single Global Secret)

**Disadvantages:**
- Single `STREAM_WORKER_SECRET` used for all streams
- Compromise of one stream affects all streams
- No per-user isolation

### Recommended Future Improvements

1. **Delegated Signing**: Use Stellar's multi-sig or a dedicated signing service
   - Secrets never stored in application database
   - Signing requests sent to secure signing service
   - Reduces application attack surface

2. **Hardware Security Module (HSM)**
   - Store secrets in HSM instead of database
   - HSM handles encryption/decryption
   - Application never sees plaintext secrets

3. **Key Rotation**
   - Implement automatic key rotation for `STREAM_SECRET_ENCRYPTION_KEY`
   - Re-encrypt all stored secrets with new key
   - Maintain backward compatibility during rotation

### Environment Configuration

Required environment variables:

```bash
# Encryption key for per-stream secrets (must be 32 bytes for AES-256)
STREAM_SECRET_ENCRYPTION_KEY=<32-byte-hex-string>

# Optional: Key rotation
STREAM_SECRET_ENCRYPTION_KEY_OLD=<previous-key-for-decryption-only>
```

### Usage

When creating a stream, provide the sender's secret:

```javascript
const stream = await createStream({
  senderPublicKey: 'G...',
  senderSecret: 'S...',  // Sender's Stellar secret key
  recipientPublicKey: 'G...',
  rateAmount: 10,
  intervalSeconds: 60,
});
```

The secret is encrypted and stored. During payment processing, it's decrypted only when needed.

### Audit & Monitoring

- All stream creation/update events are logged
- Payment processing failures are logged with stream ID (not secret)
- Monitor for unusual decryption patterns or errors
- Implement alerts for repeated decryption failures
