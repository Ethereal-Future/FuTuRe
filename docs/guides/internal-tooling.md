# Internal Tooling: Event Sourcing, Load Testing & Chaos Engineering

`backend/src/eventSourcing/`, `backend/src/loadTesting/` and `backend/src/chaos/` each expose a
Swagger-documented API (`/api-docs`, tags **Events**, **LoadTesting** and **Chaos**). This guide
explains what each subsystem is meant to do, what it **actually** does today, and its known
limitations, so nobody assumes a documented API behaves as a production-grade tool.

> **Keep this page current.** When a limitation below is fixed, update or delete that entry in the
> same PR, and update the matching `description` in the route's Swagger block
> (`backend/src/routes/events.js`, `loadTesting.js`, `chaos.js`). The page must not claim a
> limitation that no longer exists.

## Summary

| Subsystem       | Intended purpose                                               | Current reality                                           |
| --------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| Event sourcing  | Durable, replayable audit log of aggregate state changes       | In-memory only; lost on restart, not shared across tasks  |
| Load testing    | Generate concurrent traffic and measure latency/throughput     | Requests are issued serially; no genuine concurrency      |
| Chaos           | Inject latency / errors / packet loss into live request paths  | Injections are recorded but do not affect real requests   |

## Event sourcing

**Routes:** `/api/events/*` — history, state, replay, projections, analytics, stats, archive
(`backend/src/routes/events.js`).

**Intended:** append-only event store from which aggregate state can be rebuilt and replayed to any
version.

**Known limitations:**

- **Not durable.** Events are held in process memory. Every deploy, restart or crash discards the
  full history.
- **Not shared.** Each backend task/instance has its own independent store; behind a load
  balancer, a read may hit an instance that never saw the write.
- Do not treat event history returned by this API as an audit trail or a source of truth.

## Load testing

**Routes:** `/api/load-testing/*` — scenarios, run, results, baselines, regression checks,
bottleneck/capacity analysis, alerts (`backend/src/routes/loadTesting.js`).

**Intended:** define a scenario (target, duration, concurrency) and generate realistic parallel
load against it.

**Known limitations:**

- **Serial, not concurrent.** Requests are issued one after another, so the configured
  concurrency is not actually achieved. Reported throughput reflects single-client round-trip
  latency, not system capacity under load.
- Results are kept in memory and share the durability limitations described for event sourcing.
- For real capacity testing use a dedicated tool (e.g. k6, Artillery) against a staging
  environment.

## Chaos engineering

**Routes:** `/api/chaos/*` — latency/error/packet-loss injection, network partitions, service and
database failures, blast-radius limits, experiments, reports (`backend/src/routes/chaos.js`).

**Intended:** inject faults into live request handling to validate resilience (timeouts, retries,
circuit breakers).

**Known limitations:**

- **Bookkeeping only.** Injections are stored and listed by `GET /api/chaos/failures/active`, but no
  middleware consults them, so real requests are **not** delayed, failed or dropped.
- A "successful" chaos experiment therefore proves nothing about resilience today.

## Tracking

Each limitation above is tracked as its own issue in the
[issue backlog](../issues_backlog/). When closing one of those issues, update this page and the
corresponding Swagger `description` (see the note at the top).
