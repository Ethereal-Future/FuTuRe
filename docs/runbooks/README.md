# Incident Runbooks

Step-by-step procedures for responding to the most common classes of
operational incident on the FuTuRe platform. These complement — but don't
replace — the general [Operational Runbook](../runbook.md), which covers
day-to-day procedures like server restarts, backup restores, and IP unblocks.

Each runbook follows the same structure so an on-call engineer unfamiliar
with the specific subsystem can still follow it end to end:

- **Overview** — what the incident is and how it typically presents.
- **Indicators** — alerts, log patterns, and user-visible symptoms.
- **Immediate mitigation** — steps to stop further impact quickly.
- **Root cause investigation** — how to determine why it happened.
- **Resolution** — steps to fully restore service.
- **Escalation path** — when and who to escalate to.
- **Post-incident actions** — cleanup, follow-up monitoring, post-mortem.

## Index

| Runbook | Use when |
|---|---|
| [Horizon outage](horizon-outage.md) | Stellar Horizon is unreachable or returning persistent 5xx errors |
| [Database failover](db-failover.md) | The primary PostgreSQL instance is down or unhealthy |
| [JWT secret rotation](jwt-secret-rotation.md) | `JWT_SECRET` may be compromised or needs scheduled rotation |
| [Stuck transaction recovery](stuck-transaction-recovery.md) | A payment appears stuck in retry or its on-chain outcome is unknown |

## Escalation contacts

Runbooks below reference an on-call rotation and a `#incidents` channel as
placeholders for your team's actual paging tool (PagerDuty, Opsgenie, etc.)
and chat channel. Update those references once your team's tooling is
finalized — this index intentionally doesn't hardcode a specific vendor.

## Keeping these current

These are living documents. Accuracy matters more than completeness: a
shorter runbook that's correct is more valuable than a long one with
outdated steps. Review this directory quarterly, and whenever the relevant
subsystem changes (Horizon client config, database topology, auth, or the
retry/backup services these runbooks script against).
