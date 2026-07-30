# Documentation

This directory contains guides and reference documentation for the FuTuRe platform.

## Architecture

| Document                        | Description                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| [Architecture](architecture.md) | System diagram, component overview, payment flow walkthrough, and deployment topology |

## Guides

| Document                                      | Description                                                                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [API Authentication Guide](api-auth.md)       | How to obtain credentials, authenticate requests, refresh tokens, and handle auth errors — start here if you are building an integration |
| [Security Best Practices](guides/security.md) | API key storage, CSRF protection, webhook signature verification, CSP, and known attack vectors                                          |

## Operations

| Document                                        | Description                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [Runbook](runbook.md)                           | Day-to-day operational procedures — server restart, DB migration rollback, incident response, backup restore |
| [TypeScript Migration](typescript-migration.md) | Plan and conventions for the incremental JS → TS migration                                                   |

## Architecture Decision Records

Architecture decisions are recorded in [`docs/adr/`](adr/).
