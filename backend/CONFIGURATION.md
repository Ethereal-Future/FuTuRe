# Backend Configuration

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
  const computed = createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
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

| Variable | Description |
|---|---|
| `DATABASE_URL` | Direct database URL (used for migrations and health checks) |
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

## Prisma query logging

| Variable | Behaviour |
|---|---|
| `APP_ENV=development` | Query logging always enabled |
| `PRISMA_QUERY_LOG=true` | Enables query logging in any environment (useful for debugging in staging/production) |

Query events are emitted at the `debug` log level and include the query text, bound parameters, and execution duration in milliseconds.

