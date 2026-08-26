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
| [Incident Runbooks](runbooks/README.md)         | Step-by-step responses for Horizon outages, DB failover, JWT secret rotation, and stuck transaction recovery |
| [TypeScript Migration](typescript-migration.md) | Plan and conventions for the incremental JS → TS migration                                                   |

## Architecture Decision Records

Architecture decisions are recorded in [`docs/adr/`](adr/).

## Historical Implementation Notes

Point-in-time write-ups of past implementation work, kept for reference. These are not maintained going forward and may describe code that has since changed — see [`docs/history/`](history/) for the full list:

| Document                                                                                       | Description                                                    |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [Backend Auth Implementation Analysis](history/BACKEND_AUTH_IMPLEMENTATION_ANALYSIS.md)         | Status audit of the username/password backend auth implementation |
| [Contract & Snapshot Test Summary](history/CONTRACT_SNAPSHOT_SUMMARY.md)                        | Issue #481 — consumer/provider contract test additions          |
| [Security Hardening Notes](history/IMPLEMENTATION_NOTES.md)                                    | Issues #439–442 — startup secret validation and related hardening |
| [XLM Info Tooltip Summary](history/IMPLEMENTATION_SUMMARY.md)                                  | Accessible tooltip component for XLM balance labels              |
| [Implementation Summary: Issues #447–450](history/IMPLEMENTATION_SUMMARY_447-450.md)             | Security and backend fixes batch                                  |
| [Implementation Summary: Issues #559–562](history/IMPLEMENTATION_SUMMARY_559-562.md)             | Stellar account label persistence batch                          |
| [React Query Migration](history/REACT_QUERY_IMPLEMENTATION_COMPLETE.md)                        | Migration of frontend server state to `@tanstack/react-query`    |
