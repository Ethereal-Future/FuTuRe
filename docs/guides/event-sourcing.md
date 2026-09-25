# Event Sourcing

The backend records domain events (account creation, payments, stream lifecycle, multisig activity) in an append-only event store under `backend/src/eventSourcing/`. These events feed the audit trail, aggregate replay, and read-side projections exposed at `/api/events/*`.

## Storage layout

All event data is file-based and lives under `backend/data/`:

| Directory       | Contents                                                                  |
| --------------- | ------------------------------------------------------------------------- |
| `events/`       | One `<aggregateId>.jsonl` stream per aggregate, one event per line        |
| `stream-heads/` | `<aggregateId>.json` holding the highest version ever appended            |
| `snapshots/`    | Optional aggregate snapshots used as a replay starting point              |
| `projections/`  | `<name>.json` read models (`account-summary`, `payment-history`)          |
| `archive/`      | Events moved out of `events/` by the archiver                             |
| `metrics/`      | Per-event-type counters written by `eventAnalytics`                       |

The aggregate ID is the Stellar public key of the account the event concerns.

## Versioning and concurrency

Every event in an aggregate's stream has a unique, sequential `version` (1, 2, 3, …) **assigned by the store**. Any `version` field passed in by the caller is ignored.

```js
import { eventMonitor, ConcurrencyError } from '../eventSourcing/index.js';

// Append at the next version, no conflict check
await eventMonitor.publishEvent(publicKey, { type: 'PaymentSent', data });

// Append only if the stream is still at the version you read
try {
  await eventMonitor.publishEvent(publicKey, { type: 'PaymentSent', data }, expectedVersion);
} catch (err) {
  if (err instanceof ConcurrencyError) {
    // Someone else appended first: reload state and retry
  }
  throw err;
}
```

- `eventStore.append(aggregateId, event, expectedVersion)` serializes appends per aggregate. When `expectedVersion` is provided and the stream is at any other version, it throws `ConcurrencyError` (`code: 'CONCURRENCY_CONFLICT'`, with `aggregateId`, `expectedVersion`, `actualVersion`).
- Pass `expectedVersion` whenever the new event depends on state you loaded (read → decide → write). Fire-and-forget audit events can omit it.
- `eventStore.getCurrentVersion(aggregateId)` returns the stream's current version.
- The current version comes from `stream-heads/`, not from the events file, so numbering continues after the archiver removes old events.

**Limitation:** the lock is in-process. Running several backend processes against the same `data/` directory is not protected against concurrent appends.

**Legacy data:** events written before store-assigned versions all carry `version: 1`. They are still readable; new events appended to such a stream continue from the highest existing version.

## Projections

Projections are reducers registered with `projectionManager.registerProjection(name, handler)` and folded over events by `projectionManager.project(name, events)`. `eventMonitor.publishEvent` updates the default projections automatically.

Projection updates are **idempotent**:

- Each projection stores, in its `_applied` field, the last version and event ID applied for each aggregate.
- Events at or below that version are skipped, so re-projecting or replaying the same events never double-counts totals or duplicates list entries.
- Updates to a single projection are serialized, so concurrent publishes for different aggregates do not overwrite each other.

Handlers still receive each new event exactly once and do not need their own duplicate checks.

### Rebuilding a projection

If a projection file is corrupted or a handler changes, rebuild it from the full event history:

```js
import { projectionManager } from '../eventSourcing/index.js';

await projectionManager.rebuildFromGenesis('payment-history');
```

This discards the current projection, folds every event in `events/` into an empty state in timestamp/version order, and saves the result. Events already moved to `archive/` are not included.

## Replay

`eventReplayer.replay(aggregateId, toVersion?)` rebuilds an aggregate's state from its latest snapshot (or empty state) plus subsequent events. It builds fresh state on every call, so it can be run any number of times with the same result. Exposed as `GET /api/events/replay/:aggregateId?toVersion=N`.

## Archival

`eventArchiver.archiveOldEvents(olderThanDays = 30)` moves events older than the cutoff from `events/` into `archive/` (`POST /api/events/archive`). It holds each aggregate's write lock while rewriting that stream, so appends that land during archival are not lost, and it records the stream head first so versions do not restart.

## API

| Endpoint                                  | Description                                  |
| ----------------------------------------- | -------------------------------------------- |
| `GET /api/events/history/:aggregateId`    | All events for an aggregate                  |
| `GET /api/events/state/:aggregateId`      | Current replayed state                       |
| `GET /api/events/replay/:aggregateId`     | Replayed state, optionally up to `toVersion` |
| `GET /api/events/projection/:name`        | A projection, including its `_applied` field |
| `GET /api/events/analytics/:eventType`    | Hourly counts for an event type              |
| `GET /api/events/stats`                   | Count and last occurrence per event type     |
| `POST /api/events/archive`                | Archive events older than `olderThanDays`    |
| `GET /api/events/all`                     | All events, paginated with `limit`/`offset`  |
