# Security Best Practices for Platform Integrators

This guide covers the security topics most relevant to developers building on or integrating with the FuTuRe Remittance Platform.

---

## API Key Storage

Never embed API keys or JWT secrets in source code or version-controlled files.

- Store credentials in environment variables or a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.).
- Use `.env` files only for local development; exclude them via `.gitignore`.
- Rotate API keys immediately if they are accidentally committed. Treat any published key as compromised, even if the commit is reverted — Git history and CI logs may retain it.
- Apply the principle of least privilege: issue keys with only the permissions the integration needs.

---

## Subresource Integrity (SRI)

Subresource Integrity (SRI) is a browser security feature that prevents a compromised CDN from serving malicious JavaScript or CSS. An SRI hash is a cryptographic digest of a resource's content. If the hash does not match, the browser refuses to load the resource.

### SRI Format

```html
<script
  src="https://cdn.example.com/library.js"
  integrity="sha256-abc123def456..."
  crossorigin="anonymous"
></script>
```

The `integrity` attribute contains the hash algorithm and digest:

- `sha256-` — SHA-256 hash (recommended)
- Base64-encoded hash value

### Generating SRI Hashes

For a resource at `https://example.com/app.js`:

```bash
curl https://example.com/app.js | openssl dgst -sha256 -binary | openssl enc -base64
# Output: sha256-abc123def456...
```

Or use an online tool: [srihash.org](https://www.srihash.org/)

### Implementation

When hosting CDN assets for the FuTuRe frontend:

1. Generate SRI hashes for all JavaScript and CSS files
2. Embed the hashes in HTML with the `integrity` attribute
3. Always include `crossorigin="anonymous"` to ensure the response is sent securely
4. Update hashes whenever assets change
5. Monitor browser console for SRI failures (indicated by "Failed to load" or subresource integrity mismatch errors)

CSP + SRI together provide defense-in-depth:

- CSP prevents execution of inline scripts
- SRI prevents loading of compromised CDN assets

Both should be enabled in production.

Cross-Site Request Forgery (CSRF) is an attack where a malicious website tricks an authenticated user's browser into making unintended state-changing requests. The platform implements CSRF protection on all state-mutating endpoints (POST, PUT, DELETE) via the `backend/src/middleware/csrf.js` middleware.

### Token Delivery Flow

1. **Frontend initialization**: Call `GET /api/v1/auth/csrf-token` on app startup to fetch the CSRF token
2. **Token storage**: Store the token in memory (not localStorage, to prevent XSS exfiltration)
3. **Request inclusion**: Add the token as the `X-CSRF-Token` request header in all state-mutating fetch/axios calls
4. **Token refresh**: Refresh the token after login and after each successful mutation

### Backend Behavior

- All POST/PUT/DELETE requests without a valid CSRF token return `403 Forbidden`
- GET requests are never blocked by CSRF middleware
- Tokens expire after 24 hours
- A new token is generated on each GET request

### API Endpoint

```http
GET /api/v1/auth/csrf-token

Response:
{
  "csrfToken": "abc123def456..."
}
```

The token is also set as an httpOnly, secure cookie (CSRF cookie).

All outbound webhooks from FuTuRe include an `X-FuTuRe-Signature: sha256=<hex>` header. You must verify this before processing the payload.

```javascript
import { createHmac, timingSafeEqual } from 'crypto';

function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  const expected = createHmac('sha256', secret)
    .update(rawBody) // raw Buffer or string — do NOT parse as JSON first
    .digest('hex');
  const received = signatureHeader?.replace('sha256=', '') ?? '';

  // Use constant-time comparison to prevent timing attacks
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
}
```

**Key points:**

- Always use `timingSafeEqual` — a regular `===` comparison leaks information via response timing.
- Verify the raw request body _before_ JSON parsing; any middleware that mutates `req.body` will break the signature.
- Reject requests with a missing or malformed signature header with `401`.
- Rotate webhook secrets via `PATCH /api/webhooks/{id}/rotate-secret`. The previous secret stays valid for 24 hours to allow a rolling update.

---

## Multi-Factor Authentication (MFA)

High-value operations (e.g. large payments) can require TOTP-based two-factor authentication via `requireMFA` / `optionalMFA` middleware (`backend/src/middleware/mfa.js`).

- TOTP secrets are encrypted at rest (AES-256-GCM) before storage — never persist a raw TOTP secret.
- Verification uses 30-second time windows with a ±2 window tolerance to absorb client clock drift.
- Backup codes are single-use; treat them with the same handling as passwords (hash, never log).
- Set up via `POST /api/auth/mfa/setup` and verify via `POST /api/auth/mfa/verify`.

---

## OAuth2 / Social Login

The platform supports Google OAuth2 (`backend/src/security/oauth2.js`) using the standard authorization code flow: redirect to consent via `GET /api/auth/oauth/google`, exchange the code on `GET /api/auth/oauth/google/callback`, then issue platform JWTs.

- Always validate the OAuth `state` parameter to prevent CSRF on the login flow.
- Authorization codes are single-use and short-lived (10 minutes) — do not cache or retry them.
- The client secret (`GOOGLE_CLIENT_SECRET`) must never be exposed to the frontend; token exchange happens server-side only.

---

## Private Key Management

The platform generates Stellar keypairs on behalf of users. Integrators that handle keys directly must follow these rules.

- **Never log or store raw secret keys.** Use the encrypted-secret format (`ENC(<base64>)`) provided by `backend/src/config/secrets.js`. Log output is passed through `backend/src/utils/sanitizeLogData.js`, which recursively redacts any field matching `/secret|private|password|token|key/i` before it reaches Winston — but this is a safety net, not a substitute for keeping secrets out of logged objects in the first place.
- Keep the `CONFIG_ENCRYPTION_KEY` / `STREAM_SECRET_ENCRYPTION_KEY` out of application code; inject them at runtime.
- Prefer non-custodial flows where the private key never leaves the user's browser. If you must hold keys server-side, encrypt them at rest with AES-256-GCM and a per-user derived key.
- Never use real Stellar mainnet keys in development or CI environments. The testnet is reset periodically; treat any testnet key as disposable.

---

## Content Security Policy (CSP)

A Content Security Policy (CSP) is an HTTP response header that limits what resources a browser will load. It prevents injected JavaScript from executing, protecting against XSS attacks. The platform sets a strict CSP in `backend/src/middleware/securityHeaders.js` with the following directives:

- `default-src 'self'` — block all content from untrusted origins by default
- `script-src 'self' 'nonce-*'` — allow only inline scripts with a nonce, no eval()
- `style-src 'self' 'unsafe-inline'` — allow inline styles (tightened from 'unsafe-inline' in future)
- `connect-src 'self' https://horizon.stellar.org https://horizon-testnet.stellar.org` — allow Horizon API calls
- `frame-ancestors 'none'` — prevent clickjacking by disallowing iframe embedding
- `object-src 'none'` — block Flash and plugins

CSP violations are logged to `res.locals.cspNonce` for monitoring. Review logs regularly to identify unexpected script attempts.

When embedding the frontend or building your own UI on top of the API:

- Restrict `script-src` to your own origin and any explicitly trusted CDNs
- Use `connect-src` to whitelist API origins rather than `*`
- Use nonce-based or hash-based approaches for inline scripts instead of 'unsafe-inline'
- Avoid `unsafe-eval` in production

Test your CSP with the [CSP Evaluator](https://csp-evaluator.withgoogle.com/) before deploying.

---

## Known Attack Vectors

### Replay Attacks

Webhook and API requests are susceptible to replay if an attacker captures a valid signed request and resends it.

**Mitigations:**

- Include a monotonically increasing nonce or a short-lived timestamp in every signed payload.
- Reject requests with a timestamp older than ±5 minutes.
- Maintain a short-lived nonce cache (e.g., in Redis) to reject duplicate nonces within the replay window.

### Front-Running

On public blockchains, pending transactions are visible before they are confirmed. An attacker can observe a large payment and submit their own transaction with a higher fee to execute first.

**Mitigations:**

- Use Stellar's transaction `timeBounds` (`minTime` / `maxTime`) to expire transactions that are not confirmed promptly.
- For high-value flows, consider breaking a single large transfer into smaller sequential transactions.
- Avoid broadcasting transaction details publicly before submission.

### Rate-Limit Bypass

Clients that cycle IP addresses or forge headers can circumvent IP-based rate limits.

**Mitigations:**

- Prefer user-account-level rate limiting over IP-level limits for authenticated endpoints.
- Validate the `X-Forwarded-For` header only when behind a known, trusted proxy. The platform uses `getClientIP()` (`backend/src/middleware/rateLimiter.js`) to handle this safely.
- Apply exponential back-off on repeated failures rather than a fixed lockout window to resist DoS amplification.

### SQL / NoSQL Injection

The platform uses Prisma with parameterised queries. Avoid raw SQL via `$queryRaw` / `$executeRaw` unless absolutely necessary; if you must, use tagged template literals (Prisma automatically parameterises them):

```javascript
// Safe — Prisma parameterises the interpolated value
const rows = await prisma.$queryRaw`SELECT * FROM "User" WHERE id = ${userId}`;

// Unsafe — never do this
const rows = await prisma.$queryRaw(`SELECT * FROM "User" WHERE id = '${userId}'`);
```

---

## Identity Verification (KYC)

`backend/src/compliance/identityVerifier.js` does not integrate a real document-verification
provider (e.g. Jumio, Onfido). Its `_callProvider` step is a placeholder that only checks that a
submitted document number string is present and at least 5 characters — it cannot verify that a
document is genuine or belongs to the submitter.

To prevent that placeholder from masking real compliance signals:

- It refuses to run at all in `production` and `staging` (`APP_ENV`/`NODE_ENV`), so a deployed
  environment cannot silently rely on it.
- In other environments, a passing result is routed to `UNDER_REVIEW` (manual review) rather than
  auto-approved.
- Sanctions screening (`sanctionsChecker.js`) fails **closed**: an unconfigured or unreachable
  sanctions API is treated as a screening hit requiring manual review, not a clean pass, and
  production/staging refuse to start without `SANCTIONS_API_KEY` configured. See
  `SANCTIONS_FAIL_MODE` in `.env.example`.

Before enabling automated KYC approval in a deployed environment, integrate a real provider in
`_callProvider` and remove the manual-review gate for its passing results.

---

## Reporting Vulnerabilities

If you discover a security issue, please report it privately to the maintainers before public disclosure. Open a GitHub Security Advisory rather than a public issue so the team can coordinate a fix.

---

## GDPR Erasure and Compliance-Record Retention

Account deletion anonymises the user and KYC record and removes personal transaction memos. **AML alerts and security audit logs are retained** because they support legally required anti-money-laundering reporting and security incident response. Retention is an exception to erasure only for the documented compliance purpose and should be bounded by the organisation’s approved retention schedule; the exact statutory window requires legal/compliance ownership and is not hard-coded here.

As part of the same account-deletion transaction, the service scrubs free-text and network-identifying data from retained records. AML alerts remain linked to the anonymised user and transaction for regulatory traceability, but their description is replaced with an account-deletion marker. Audit logs retain their event type, timestamp, severity, and anonymised user linkage while replacing `details` with a minimal retention marker and clearing `ipAddress`, `userAgent`, and `resourceId`. The deletion itself creates an `ACCOUNT_DELETION` audit event that records only that retained records were scrubbed for compliance.

Operators must maintain a scheduled retention job to permanently remove AML alerts and audit logs once their approved legal retention window expires. Do not re-identify retained records or add raw KYC, address, IP, user-agent, or free-text transaction context after erasure. See the implementation in `backend/src/routes/auth.js` and the audit-event contract in `backend/src/security/auditLogger.js`.
