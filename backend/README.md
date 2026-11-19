# Backend

Node.js + Express API for the Stellar Remittance Platform. Runs on port `3001` by default.

## Requirements

- Node.js 20+
- PostgreSQL
- Redis (optional for local dev, recommended for production — enables distributed cache)

## Local Development

```bash
cp .env.example .env
# edit .env with your DATABASE_URL and other settings

npm install
npx prisma migrate deploy
node src/server.js
```

See `CONFIGURATION.md` for all environment variables.

## Docker

### Build

```bash
docker build -t stellar-backend .
```

### Run

```bash
docker run -p 3001:3001 --env-file .env stellar-backend
```

The container exposes port `3001`. Pass a different port via the `PORT` env variable:

```bash
docker run -p 8080:8080 -e PORT=8080 --env-file .env stellar-backend
```

### Database migrations

Migrations are not run automatically on container start. Run them separately before the first start (or as an init container):

```bash
docker run --rm --env-file .env stellar-backend \
  node -e "import('./src/db/migrate.js')"
```

Or via `npx prisma migrate deploy` with `DATABASE_URL` set.

### Health check

The image has a built-in `HEALTHCHECK` on `GET /health`. You can also check it manually:

```bash
curl http://localhost:3001/health
```

### Docker Compose example

```yaml
services:
  backend:
    build: ./backend
    ports:
      - "3001:3001"
    env_file: ./backend/.env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: stellar
      POSTGRES_USER: stellar
      POSTGRES_PASSWORD: secret
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U stellar"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
```

## Production Deployment

### Multi-Instance (ECS) Requirements

When deploying multiple backend instances (ECS tasks), Redis is **required** for distributed cache coherence:

- **IP Whitelist**: Shared across instances via Redis Pub/Sub
- **AMM Pool Reserves**: Synchronized via Redis Pub/Sub + optimistic locking
- **Rate Limiting**: Shared counters (when using Redis backend)

**Configuration:**
```bash
REDIS_HOST=your-elasticache.amazonaws.com
REDIS_PORT=6379
REDIS_AUTH_TOKEN=<from-secrets-manager>
REDIS_TLS=true
```

**Without Redis:** Each instance maintains local-only cache, which may lead to:
- Stale IP whitelist entries (security risk)
- Inconsistent rate limiting across instances
- AMM pool reserve race conditions

See [`docs/operations/DISTRIBUTED_CACHE.md`](../docs/operations/DISTRIBUTED_CACHE.md) for detailed operational procedures.

## Key Features

- **Distributed Caching**: Two-tier (L1 in-memory + L2 Redis) with Pub/Sub invalidation
- **Security**: IP whitelisting, rate limiting, JWT auth, MFA support
- **Stellar Integration**: Payment streaming, fee-bump, multisig custody
- **Compliance**: Sanctions screening (OFAC), AML monitoring, audit logging
- **Observability**: Structured logging, distributed tracing (OTLP), Prometheus metrics

## Documentation

- [Configuration Guide](./CONFIGURATION.md) — All environment variables
- [Distributed Cache Operations](../docs/operations/DISTRIBUTED_CACHE.md) — Cache troubleshooting & monitoring
- [ADR-0003: Caching Strategy](../docs/adr/0003-caching-strategy.md) — Architecture decisions
