# Documentation

This is the documentation map for the FuTuRe platform — every markdown doc in the repository, grouped by audience. If you add a new docs file, register it here too (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

## Getting Started

| Document                                                  | Description                                                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [Contributing Guide](../CONTRIBUTING.md)                  | Local setup, running tests, branch naming, PR process, code style, commit conventions                 |
| [Glossary](GLOSSARY.md)                                   | Stellar and remittance/compliance terms used in this codebase, with links to real usage               |
| [Troubleshooting](guides/troubleshooting.md)              | Fixes for common local dev failures — Docker ports, Prisma drift, Friendbot, npm workspaces, env vars |
| [Backend README](../backend/README.md)                   | Backend requirements, scripts, and directory layout                                                   |
| [Frontend README](../frontend/README.md)                 | Frontend requirements, scripts, and directory layout                                                  |
| [Stellar Contract README](../stellar-contract/README.md) | Soroban prediction-market smart contract — purpose, build, and deploy                                 |

## Architecture

| Document                             | Description                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Architecture](architecture.md)      | System diagram, component overview, payment flow walkthrough, and deployment topology |
| [Infrastructure](../infra/README.md) | Terraform configuration for deploying the platform to AWS                             |

## Guides

| Document                                                        | Description                                                                                                                              |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [API Authentication Guide](api-auth.md)                         | How to obtain credentials, authenticate requests, refresh tokens, and handle auth errors — start here if you are building an integration |
| [Security Best Practices](guides/security.md)                  | API key storage, CSRF protection, webhook signature verification, CSP, and known attack vectors                                          |
| [Streaming Payment Security](../backend/STREAMING_SECURITY.md) | Per-stream secret encryption model and trade-offs for recurring payments                                                                 |
| [Troubleshooting](guides/troubleshooting.md)                    | Local development environment problems — see also Getting Started above                                                                 |

## Operations

| Document                                | Description                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Runbook](runbook.md)                   | Day-to-day operational procedures — server restart, DB migration rollback, incident response, backup restore |
| [Incident Runbooks](runbooks/README.md) | Step-by-step responses for Horizon outages, DB failover, JWT secret rotation, and stuck transaction recovery |

## Migrations

| Document                                                                          | Description                                                                                |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [TypeScript Migration Plan](typescript-migration.md)                             | Backend-wide plan and conventions for the incremental JS → TS migration                   |
| [Frontend TypeScript Migration Status](../frontend/docs/typescript-migration.md) | Frontend-specific migration status and phase tracking                                     |
| [React Query Migration](../frontend/REACT_QUERY_MIGRATION.md)                    | Migration of frontend server state from `useEffect`/`useState` to `@tanstack/react-query` |

## Testing

| Document                                                 | Description                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| [Coverage Follow-up Issues](coverage-followup-issues.md) | Files with 0% test coverage, tracked as individual follow-up issues |

## Frontend Notes

| Document                                                 | Description                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [XLM Info Tooltip](../frontend/docs/XLM_INFO_TOOLTIP.md) | Accessible tooltip component explaining XLM balance labels to new users |
| [Locale Files](../frontend/src/i18n/locales/README.md)   | Supported languages and translation file conventions                    |

## Architecture Decision Records

Architecture decisions are recorded in [`docs/adr/`](adr/).

## Historical Implementation Notes

Point-in-time write-ups of past implementation work, kept for reference. These are not maintained going forward and may describe code that has since changed — see [`docs/history/`](history/) for the full list:

| Document                                                                                 | Description                                                        |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [Backend Auth Implementation Analysis](history/BACKEND_AUTH_IMPLEMENTATION_ANALYSIS.md) | Status audit of the username/password backend auth implementation |
| [Contract & Snapshot Test Summary](history/CONTRACT_SNAPSHOT_SUMMARY.md)                | Issue #481 — consumer/provider contract test additions            |
| [Security Hardening Notes](history/IMPLEMENTATION_NOTES.md)                             | Issues #439–442 — startup secret validation and related hardening |
| [XLM Info Tooltip Summary](history/IMPLEMENTATION_SUMMARY.md)                           | Accessible tooltip component for XLM balance labels                |
| [Implementation Summary: Issues #447–450](history/IMPLEMENTATION_SUMMARY_447-450.md)   | Security and backend fixes batch                                   |
| [Implementation Summary: Issues #559–562](history/IMPLEMENTATION_SUMMARY_559-562.md)   | Stellar account label persistence batch                            |
| [React Query Migration](history/REACT_QUERY_IMPLEMENTATION_COMPLETE.md)                | Migration of frontend server state to `@tanstack/react-query`      |
