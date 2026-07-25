# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## Deprecation Policy

This project follows a **minimum 90-day deprecation notice** policy for all public API endpoints and configuration interfaces.

### Process

1. **Announce** — the endpoint is marked with `Deprecation: <date>` and `Sunset: <date>` response headers. The sunset date is at least 90 days after the deprecation date.
2. **Notify** — a note is added to the relevant `[Unreleased]` section of this changelog.
3. **Link** — a `Link: <successor>; rel="successor-version"` header points consumers to the replacement.
4. **Remove** — on or after the sunset date the endpoint may be removed in a new major version.

### Adding deprecation headers in code

Use the `deprecate()` middleware from `backend/src/middleware/deprecation.js`:

```js
import { deprecate } from '../middleware/deprecation.js';

router.get(
  '/v1/old-endpoint',
  deprecate({ sunset: '2026-10-01', link: '/api/v2/new-endpoint' }),
  handler,
);
```

The middleware enforces the 90-day minimum at startup (throws if the sunset date is too soon).

### Current deprecated endpoints

_None at this time._

---

## [1.0.0] - 2026-05-28

### Added

#### Core Platform
- Cross-border remittance platform built on the Stellar blockchain
- Stellar account creation, funding (testnet), and import via secret key
- XLM and non-XLM asset balance retrieval
- Trustline management (add/remove/list)
- Payment sending with optional fee-bump sponsorship for low-balance accounts
- Path payment support for cross-asset conversions
- Exchange rate service with multi-currency conversion
- AMM (Automated Market Maker) integration

#### Authentication & Security
- JWT-based authentication with refresh token rotation
- Password hashing with bcrypt
- TOTP-based multi-factor authentication (MFA) with AES-256-GCM encrypted secrets
- Google OAuth2 login
- CSRF protection middleware
- Input sanitization and validation via express-validator and Zod
- Security headers middleware (Helmet-style)
- Rate limiting per endpoint with configurable windows and whitelists

#### Database
- PostgreSQL via Prisma ORM with `@prisma/adapter-pg` driver adapter
- PgBouncer transaction-pooling support
- Database sharding across multiple PostgreSQL instances
- Soft-delete middleware for User, Transaction, and related models
- Configurable connection pool (`DB_POOL_MAX`) and query timeout (`DB_QUERY_TIMEOUT_MS`)
- Automated migrations on startup

#### Payment Streaming
- Real-time payment streams with per-stream sender secret encryption (AES-256-GCM)
- WebSocket push for live balance and stream updates

#### Notifications
- Web Push notifications (VAPID)
- Email notifications via SMTP (stubbed when unconfigured)
- SMS notifications via Twilio (stubbed when unconfigured)
- Per-user notification preferences

#### Compliance & KYC
- KYC record collection and status tracking
- AML monitoring and alert generation
- Sanctions screening
- Risk scoring
- Compliance audit logging and reporting
- Identity verification workflow

#### Analytics & Monitoring
- Request-level performance middleware with configurable alert thresholds
- OpenTelemetry distributed tracing (OTLP HTTP export)
- Winston structured logging with daily log rotation
- Prometheus-compatible metrics endpoint
- User behaviour analytics and fraud detection
- Event sourcing with projection manager, archiver, and replayer

#### Caching
- Multi-level cache: in-memory L1 + optional Redis L2
- Per-route cache middleware with configurable TTLs
- Cache invalidation on balance-changing operations
- Cache analytics, monitoring, and warming utilities

#### Infrastructure
- Docker development environment (`Dockerfile.dev`)
- CDN middleware with multi-region edge support
- Microservices gateway, service mesh, and discovery utilities
- Chaos engineering toolkit (failure injection, network partition simulation, blast-radius limiter)
- Load testing framework with k6 scenarios and bottleneck analysis
- Backup and recovery manager with optional AES encryption and configurable retention
- Scheduled jobs via internal scheduler

#### Developer Experience
- OpenAPI / Swagger documentation (`/api-docs`)
- Vitest test suite (unit, integration, performance, property-based, contract)
- Stryker mutation testing
- Prettier code formatting

[Unreleased]: https://github.com/Ethereal-Future/FuTuRe/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Ethereal-Future/FuTuRe/releases/tag/v1.0.0
