# Backend Configuration

## Quick Start (minimum required variables)

Copy the example file and fill in the secrets marked **required** below:

```bash
cp env.example.txt .env
```

The absolute minimum to run the backend locally:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://user:password@localhost:5432/future_remittance` |
| `STREAM_SECRET_ENCRYPTION_KEY` | 64-char hex — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_SECRET` | Any non-empty string (use a strong random value in production) |

Everything else has a safe default for local development.

---

## All Environment Variables

> **Legend** — Required: ✅ always · ⚠️ production only · — optional  
> 🔑 = must be rotated if compromised

### Core

| Variable | Type | Required | Default | Description | Example |
|---|---|---|---|---|---|
| `APP_ENV` | string | — | `development` | Runtime environment. Controls validation strictness and defaults. | `production` |
| `CONFIG_VERSION` | integer | — | `1` | Config schema version. Must match the expected value or startup fails. | `1` |
| `CONFIG_WATCH` | boolean | — | `false` | Reload config when `.env*` files change (ignored in `test`). | `true` |
| `PORT` | integer | — | `3001` | TCP port the Express server listens on. | `3001` |

### CORS

| Variable | Type | Required | Default | Description | Example |
|---|---|---|---|---|---|
| `ALLOWED_ORIGINS` | CSV | ⚠️ | `http://localhost:3000,http://localhost:5173` | Comma-separated list of allowed CORS origins. Required in production. | `https://app.example.com` |

### Stellar

| Variable | Type | Required | Default | Description | Example |
|---|---|---|---|---|---|
| `STELLAR_NETWORK` | string | — | `testnet` (dev/test), `mainnet` (prod) | Stellar network. Accepts `testnet` or `mainnet` (alias `public`). | `mainnet` |
| `HORIZON_URL` | URL | — | Auto-selected by network | Stellar Horizon API endpoint. | `https://horizon.stellar.org` |
| `ASSET_ISSUER` | string | — | — | Default issuer for non-XLM assets. Required when sending non-XLM payments. | `GCEZ...` |
| `PLATFORM_FEE_ACCOUNT_SECRET` 🔑 | string | — | — | Secret key of the fee-bump sponsor account. When set, low-balance senders get fee-bumped. | `SABC...` |
| `FEE_BUMP_THRESHOLD_XLM` | number | — | `2` | XLM balance below which fee-bumping is applied. | `2` |
| `FEE_BUMP_MULTIPLIER` | integer | — | `10` | Fee multiplier applied to `BASE_FEE` for fee-bump transactions. | `10` |

### Security & Auth

| Variable | Type | Required | Default | Description | Example |
|---|---|---|---|---|---|
| `JWT_SECRET` 🔑 | string | ✅ | `secret` (dev only) | HMAC secret for signing JWT tokens. Must not be the default in production. | `<random 64-char hex>` |
| `MFA_ENCRYPTION_KEY` 🔑 | string | — | — | AES-256-GCM key for encrypting TOTP secrets at rest. Generate with `openssl rand -hex 32`. | `<32-byte hex>` |
| `GOOGLE_CLIENT_ID` | string | — | — | Google OAuth2 client ID. Required to enable Google login. | `123456.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` 🔑 | string | — | — | Google OAuth2 client secret. | `GOCSPX-...` |
| `SERVER_BASE_URL` | URL | — | `http://localhost:3001` | Public base URL of this server (used for OAuth callbacks). | `https://api.example.com` |
| `FRONTEND_BASE_URL` | URL | — | `http://localhost:3000` | Public base URL of the frontend (used for post-auth redirects). | `https://app.example.com` |
| `WS_MSG_SECRET` 🔑 | string | — | — | HMAC secret for signing outbound WebSocket message envelopes. | `<random 64-char hex>` |
| `CONFIG_ENCRYPTION_KEY` 🔑 | string | — | — | Key for decrypting `ENC(...)` values in env files (AES-256-GCM). | `<strong passphrase>` |
| `PLATFORM_SECRET_KEY` 🔑 | string | — | — | Platform-level secret key (internal signing). | `<random hex>` |

### Payment Streaming

| Variable | Type | Required | Default | Description | Example |
|---|---|---|---|---|---|
| `STREAM_SECRET_ENCRYPTION_KEY` 🔑 | string | ✅ | — | AES-256-GCM key for encrypting per-stream sender secrets at rest. Must be a 64-char hex string. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | `a1b2c3...` |

### Database

| Variable | Type | Required | Default | Description | Example |
|---|---|---|---|---|---|
| `DATABASE_URL` | URL | ✅ | — | Primary PostgreSQL connection string (also used for migrations). | `postgresql://user:pass@localhost:5432/db` |
| `DATABASE_POOL_URL` | URL | — | — | PgBouncer pooler URL for transaction pooling. When set, Prisma uses this for queries. | `postgresql://user:pass@pgbouncer:6432/db` |
| `DB_SHARD_COUNT` | integer | — | `1` | Number of database shards (1 = no sharding). | `2` |
| `DB_SHARD_0_URL` | URL | — | Falls back to `DATABASE_URL` | Connection URL for shard 0. | `postgresql://user:pass@shard0:5432/db` |
| `DB_POOL_MAX` | integer | — | `10` | Max connections per Prisma pool. Recommended: 10 (dev), 25–50 (prod). | `25` |
| `DB_QUERY_TIMEOUT_MS` | integer | — | `5000` | Query timeout in milliseconds. Applied as both `statement_timeout` and a Node.js guard. | `5000` |
| `PRISMA_QUERY_LOG` | boolean | — | `false` | Enable Prisma query logging outside of development mode. | `true` |

### Rate Limiting

| Variable | Type | Required | Default | Description | Example |
|---|---|---|---|---|---|
| `RATE_LIMIT_WINDOW_MS` | integer | — | `60000` | Rate-limit window in milliseconds. | `60000` |
| `RATE_LIMIT_MAX` | integer | — | `100` | Max requests per window per IP. | `100` |
| `RATE_LIMIT_MESSAGE` | string | — | `"Too many requests..."` | Error message returned when rate-limited. | `"Slow down!"` |
| `RATE_LIMIT_WHITELIST` | CSV | — | — | Comma-separated IPs/CIDR ranges exempt from rate limiting. | `127.0.0.1,10.0.0.0/8` |

### Caching

| Variable | Type | Required | Default | Description | Example |
|---|---|---|---|---|---|
| `REDIS_URL` | URL | — | — | Redis connection URL. Falls back to in-memory L1 cache when not set. | `redis://localhost:6379` |
| `CACHE_TTL_BALANCE_S` | integer | — | `30` | Cache TTL (seconds) for account balance responses. | `30` |
| `RATE_CACHE_TTL_S` | integer | — | `60` | Cache TTL (seconds) for exchange-rate responses. | `60` |
| `CACHE_TTL_FEE_S` | integer | — | `120` | Cache TTL (seconds) for fee-stat responses. | `120` |

### CDN

| Variable | Type | Required | Default | Description | Example |
|---|---|---|---|---|---|
| `CDN_ENABLED` | boolean | — | `false` | Enable CDN integration and Cache-Control headers. | `true` |
| `CDN_URL` | URL | — | — | Primary CDN origin URL. | `https://cdn.example.com` |
| `CDN_SECONDARY_URL` | URL | — | — | Fallback CDN origin URL for automatic failover. | `https://cdn2.example.com` |
| `CDN_REGIONS` | CSV | — | `us-east-1` | Comma-separated CDN edge regions. | `us-east-1,eu-west-1` |
| `CDN_CACHE_MAX_AGE_S` | integer | — | `86400` | Default cache TTL (seconds) for API responses. | `86400` |

### Performance & Observability

| Variable | Type | Required | Default | Description | Example |
|---|---|---|---|---|---|
| `PERF_ALERT_RESPONSE_MS` | integer | — | `2000` | Alert threshold for API response time in ms. | `2000` |
| `PERF_ALERT_ERROR_RATE` | number | — | `0.1` | Alert threshold for error rate (fraction 0–1). | `0.1` |
| `LOG_LEVEL` | string | — | `info` | Winston log level (`error`, `warn`, `info`, `debug`). | `debug` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | URL | — | — | OTLP HTTP endpoint for distributed tracing. Falls back to console when not set. | `http://localhost:4318` |
| `NEW_RELIC_LICENSE_KEY` 🔑 | string | — | — | New Relic license key (enables APM when set). | `...` |
| `DD_API_KEY` 🔑 | string | — | — | DataDog API key (enables APM when set). | `...` |

### Notifications

| Variable | Type | Required | Default | Description | Example |
|---|---|---|---|---|---|
| `EMAIL_HOST` | string | — | — | SMTP host. A no-op stub is used when not set. | `smtp.example.com` |
| `EMAIL_PORT` | integer | — | — | SMTP port. | `587` |
| `EMAIL_USER` | string | — | — | SMTP username. | `notifications@example.com` |
| `EMAIL_PASS` 🔑 | string | — | — | SMTP password. | `...` |
| `EMAIL_FROM` | string | — | — | From address for outbound email. | `noreply@futureremit.app` |
| `TWILIO_ACCOUNT_SID` | string | — | — | Twilio Account SID (enables SMS when set). | `ACxxx...` |
| `TWILIO_AUTH_TOKEN` 🔑 | string | — | — | Twilio auth token. | `...` |
| `TWILIO_FROM_NUMBER` | string | — | — | Twilio sender phone number (E.164 format). | `+10000000000` |

### Alerting

| Variable | Type | Required | Default | Description | Example |
|---|---|---|---|---|---|
| `ALERT_EMAIL` | string | — | — | Email address for critical operational alerts. | `ops@example.com` |
| `SLACK_WEBHOOK_URL` 🔑 | URL | — | — | Slack incoming webhook URL for notifications. | `https://hooks.slack.com/...` |

### Backup & Recovery

| Variable | Type | Required | Default | Description | Example |
|---|---|---|---|---|---|
| `BACKUP_DIR` | string | — | `./backups` | Local directory for backup files. | `/var/backups/future` |
| `BACKUP_ENC_KEY` 🔑 | string | — | — | 64-char hex key for AES-encrypted backups (`openssl rand -hex 32`). Required for encrypted backups. | `<64-char hex>` |
| `BACKUP_RETENTION_DAYS` | integer | — | `7` | Number of days to retain backups. | `30` |
| `BACKUP_INTERVAL_HOURS` | integer | — | `24` | Hours between automated backup runs. | `24` |

---

> 🔑 **Secret rotation**: rotate these variables immediately if exposed. After rotation, redeploy all running instances to pick up the new value. For `STREAM_SECRET_ENCRYPTION_KEY`, re-encrypt stored stream secrets using the migration script in `scripts/rotate-stream-key.js` before the old key is removed.

---

The backend reads configuration from:

1. Runtime environment variables (`process.env`)
2. `.env*` files in `backend/` (fallbacks)

## Environments

Set `APP_ENV` to enable environment-specific defaults and validation:

- `development` (default)
- `test`
- `production`

## `.env` file loading

Files are loaded in this precedence order (later wins):

1. `.env`
2. `.env.<APP_ENV>`
3. `.env.local` (skipped when `APP_ENV=test`)
4. `.env.<APP_ENV>.local` (skipped when `APP_ENV=test`)

`process.env` always overrides values from files.

## Required variables (production)

When `APP_ENV=production`:

- `ALLOWED_ORIGINS` (comma-separated)
- `JWT_SECRET` (must not be `secret`)

## Hot-reloading

Set `CONFIG_WATCH=true` to reload config when `.env*` files change.

- Changes apply to consumers that call `getConfig()` at runtime (e.g. CORS origin checks).
- Some values (like `PORT`) are still read once at startup.

## Encrypted secrets (optional)

You can store encrypted values using `ENC(<base64>)` or `enc:<base64>`, and provide a key via:

- `CONFIG_ENCRYPTION_KEY` (preferred)
- `CONFIG_SECRET_KEY` (alias)

The code uses AES-256-GCM with a SHA-256 derived key. See `backend/src/config/secrets.js`.

## API Versioning

The API uses semantic versioning with the `/api/v1/` prefix for all routes.

### Versioning Strategy

- **Current version**: `/api/v1/` (all routes mounted here)
- **Unversioned paths**: Requests to `/api/*` (without version) are automatically redirected to `/api/v1/*` with a 301 status code
- **Deprecation headers**: Unversioned requests receive:
  - `Deprecation: true`
  - `Sunset: <date 90 days from now>`
  - `Link: </api/v1/...>; rel="successor-version"`

### Health endpoints

Health check endpoints are **not versioned** and remain at the root level for compatibility with load balancers and orchestration platforms:

- `GET /health` - Basic health check
- `GET /health/live` - Liveness probe (Kubernetes)
- `GET /health/ready` - Readiness probe (Kubernetes)
- `GET /health/detailed` - Detailed health report (auth-gated)
- `GET /metrics` - System metrics

### Frontend integration

The frontend is configured to use `/api/v1/` as the base URL for all API calls via `axios.defaults.baseURL`. This is set in `frontend/src/utils/axiosConfig.js`.

### Migration path

When introducing breaking changes:

1. Implement the new behavior in a new version (e.g., `/api/v2/`)
2. Keep `/api/v1/` stable for 90 days
3. Clients have 90 days to migrate (indicated by `Sunset` header)
4. After 90 days, `/api/v1/` can be deprecated or removed

## Webhook Signature Verification

All outbound webhook requests include HMAC-SHA256 signatures for verification.

### Signature Header

Webhooks are sent with the `X-FuTuRe-Signature` header containing the signature:

```
X-FuTuRe-Signature: sha256=<hex-encoded-signature>
```

### Verification Algorithm

To verify a webhook signature:

1. Extract the signature from the `X-FuTuRe-Signature` header
2. Extract the `sha256=` prefix to get the hex-encoded signature
3. Compute HMAC-SHA256 of the raw request body using your webhook secret
4. Compare the computed signature with the received signature (constant-time comparison)

### Example Verification (Node.js)

```javascript
import { createHmac } from 'crypto';

function verifyWebhookSignature(payload, signature, secret) {
  const computed = createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');

  return computed === signature;
}

// In your webhook handler:
const signature = req.headers['x-future-signature']?.replace('sha256=', '');
const isValid = verifyWebhookSignature(req.body, signature, process.env.WEBHOOK_SECRET);

if (!isValid) {
  return res.status(401).json({ error: 'Invalid signature' });
}
```

### Secret Rotation

Webhook secrets can be rotated via the `/api/webhooks/{id}/rotate-secret` endpoint. During rotation:

- The new secret becomes active immediately
- Previous secrets remain valid for a grace period (typically 24 hours)
- This allows consumers time to update their verification logic

### Headers Included

Each webhook request includes:

- `X-FuTuRe-Signature`: HMAC-SHA256 signature
- `X-Webhook-Id`: Unique webhook identifier
- `Content-Type`: `application/json`

## Database connection pooling (PgBouncer)

For production deployments running multiple Node.js instances, a connection pooler prevents connection exhaustion.

### Environment variables

| Variable            | Description                                                      |
| ------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`      | Direct database URL (used for migrations and health checks)      |
| `DATABASE_POOL_URL` | PgBouncer pooler URL. When set, Prisma uses this for all queries |

### PgBouncer setup

1. Configure PgBouncer in **transaction pooling** mode (`pool_mode = transaction`).
2. Set `DATABASE_POOL_URL` to the PgBouncer connection string, e.g.:
   ```
   DATABASE_POOL_URL=postgresql://user:password@pgbouncer:6432/future_remittance
   ```
3. The app automatically appends `?pgbouncer=true` to the pooler URL, which disables prepared statements — required for transaction pooling mode.
4. Keep `DATABASE_URL` pointing at the primary Postgres instance so migrations (`prisma migrate deploy`) bypass the pooler.

### PgBouncer configuration reference (`pgbouncer.ini`)

```ini
[databases]
future_remittance = host=postgres port=5432 dbname=future_remittance

[pgbouncer]
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 25
server_reset_query =
```

> `server_reset_query` must be empty in transaction mode because connections are not owned by a single client between statements.

## CDN Setup

The backend includes CDN middleware (`backend/src/cdn/index.js`) that sets `Cache-Control` and security headers on all responses.

### Environment variables

| Variable              | Description                                               | Default     |
| --------------------- | --------------------------------------------------------- | ----------- |
| `CDN_ENABLED`         | Enable CDN integration                                    | `false`     |
| `CDN_URL`             | Primary CDN origin URL                                    | —           |
| `CDN_SECONDARY_URL`   | Fallback CDN origin URL                                   | —           |
| `CDN_CACHE_MAX_AGE_S` | Default cache TTL in seconds (used for API responses)     | `86400`     |
| `CDN_REGIONS`         | Comma-separated list of CDN regions                       | `us-east-1` |
| `VITE_CDN_URL`        | CDN base URL for frontend asset paths (set at build time) | `/`         |

### Cache-Control strategy

| Path pattern                 | Header                                                         | Rationale                                                     |
| ---------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| `/assets/*`                  | `Cache-Control: public, max-age=31536000, immutable`           | Vite produces content-hashed filenames; safe to cache forever |
| `*.html` (e.g. `index.html`) | `Cache-Control: no-cache`                                      | Must always revalidate so clients pick up new asset hashes    |
| `/api/*`                     | `Cache-Control: public, max-age=30, stale-while-revalidate=60` | Short TTL for API data                                        |

### Enabling CDN in production

1. Set `CDN_ENABLED=true`.
2. Set `CDN_URL` to your CDN origin (e.g. `https://cdn.example.com`).
3. Set `VITE_CDN_URL` to the same value at frontend build time so asset URLs point to the CDN.
4. Optionally set `CDN_SECONDARY_URL` for automatic failover.

The middleware also emits `Surrogate-Control` headers for Fastly/Varnish and `Vary: Accept-Encoding` on all responses to support compressed variants in the CDN cache.

## Prisma query logging

| Variable                | Behaviour                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `APP_ENV=development`   | Query logging always enabled                                                          |
| `PRISMA_QUERY_LOG=true` | Enables query logging in any environment (useful for debugging in staging/production) |

Query events are emitted at the `debug` log level and include the query text, bound parameters, and execution duration in milliseconds.

---

## Data Retention Policy (GDPR)

The platform complies with GDPR Article 15 (right of access) and Article 17 (right to erasure).

### Data export

Users may request a full export of their personal data at any time via `GET /api/auth/data-export`. The response is a JSON document containing their profile, settings, KYC record, transactions, and notifications. Password hashes are excluded from the export.

### Account deletion

When a user calls `DELETE /api/auth/account`, the following happens immediately:

1. **Soft-delete** — the user's `deletedAt` timestamp is set to the current time.
2. **Anonymisation** — `publicKey` is replaced with `ANONYMIZED-<id_prefix>`, `username` with `deleted-<id_prefix>`, and `passwordHash` is cleared.
3. **KYC redaction** — all KYC fields (`fullName`, `dateOfBirth`, `nationality`, `documentType`, `documentNumber`, `address`, `phoneNumber`, `email`) are replaced with `[REDACTED]`.
4. **Transaction memo clearing** — `memo` fields on all transactions associated with the user are set to `null`. Transaction amounts and hashes are retained for audit and financial compliance purposes.

The response includes a `scheduledPermanentDeletion` timestamp 30 days from the deletion request. A background job (to be configured separately) should permanently remove the anonymised record after this date.

### Retention periods

| Data category                         | Retention period               | Basis                          |
| ------------------------------------- | ------------------------------ | ------------------------------ |
| Transaction records (amounts, hashes) | 7 years                        | Financial regulation (AML/KYC) |
| Audit logs                            | 5 years                        | Regulatory compliance          |
| Anonymised user record                | 30 days after deletion request | GDPR cooling-off period        |
| KYC documents                         | 5 years after account closure  | AML regulations                |
| Session / refresh tokens              | 7 days (cookie `maxAge`)       | Operational necessity          |

## Compliance & AML Configuration

### KYC enforcement

Payments above `KYC_LARGE_TRANSACTION_LIMIT` XLM are blocked at `POST /api/stellar/payment/send` unless the sender has an `APPROVED` KYC record. The middleware returns `403 { error: "KYC_REQUIRED", kycStatus: "..." }`.

| Variable | Default | Description |
|---|---|---|
| `KYC_LARGE_TRANSACTION_LIMIT` | `1000` | XLM threshold above which KYC approval is required |

### Sanctions screening (#501)

Every payment screens both sender and recipient against OFAC SDN, UN, and EU sanctions lists via the configured API before the transaction is submitted to Stellar. A match returns `403 { error: "SANCTIONS_HIT", reason: "..." }` and the payment is not submitted.

| Variable | Default | Description |
|---|---|---|
| `SANCTIONS_API_KEY` | — | API key for the sanctions screening provider (required in production) |
| `SANCTIONS_API_URL` | `https://api.ofac-api.com/v4/search` | Screening endpoint (OFAC-API compatible) |
| `SANCTIONS_MIN_SCORE` | `85` | Minimum fuzzy-match score (0–100) to treat as a hit |

**Without `SANCTIONS_API_KEY`** the check is skipped with a console warning. This is acceptable for development but **must be configured before going to production**.

Compatible providers: [OFAC-API](https://ofac-api.com), [Comply Advantage](https://complyadvantage.com), [Chainalysis](https://chainalysis.com).

### AML transaction monitoring (#502)

After each successful payment, `amlMonitor.screenTransaction()` runs asynchronously and creates `AMLAlert` records in the database for any triggered rules. Alerts are visible at `GET /api/compliance/aml-alerts` (admin only).

| Variable | Default | Description |
|---|---|---|
| `AML_LARGE_TX_THRESHOLD` | `10000` | Single transaction amount that triggers `LARGE_TX` |
| `AML_STRUCTURING_THRESHOLD` | `1000` | Per-transaction ceiling for structuring detection |
| `AML_STRUCTURING_COUNT` | `3` | Number of sub-threshold transactions in 24 h to trigger `STRUCTURING` |
| `AML_VELOCITY_LIMIT` | `10000` | Total sent in 24 h that triggers `VELOCITY` |

Rules implemented:

- **LARGE_TX** — single transaction ≥ `AML_LARGE_TX_THRESHOLD`
- **STRUCTURING** — more than `AML_STRUCTURING_COUNT` transactions each below `AML_STRUCTURING_THRESHOLD` within 24 h
- **VELOCITY** — cumulative 24 h send total exceeds `AML_VELOCITY_LIMIT`
- **UNVERIFIED_USER** — sender has no approved KYC record

### Web Vitals analytics (#499)

Frontend metrics (LCP, CLS, INP, FCP, TTFB) are sent via `navigator.sendBeacon` to `POST /api/analytics/web-vitals` on every page load. Aggregated p75 values are available at `GET /api/analytics/web-vitals/dashboard` (requires auth).

The current implementation stores metrics in memory. For production, replace `webVitalsStore` in `backend/src/routes/analytics.js` with a time-series database (e.g. InfluxDB, TimescaleDB, or a Prometheus push gateway).
