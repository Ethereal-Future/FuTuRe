# ADR-0005: Fail-closed event schema migrations

* Status: Accepted
* Deciders: Core engineering team
* Date: 2026-08-27

## Context and Problem Statement

`eventSerializer` versions each event type via `SCHEMA_VERSIONS` and is supposed to run `{Type}_vN_to_vN+1` methods when a stored event's `schemaVersion` lags the current one. Until this change, a missing method was skipped and the event was still stamped with the new version, so consumers could not tell a real migration from a silent no-op.

## Decision Drivers

* Stored events must never be labeled as a schema they were not actually transformed into
* Adding a real version bump must be an explicit, tested code change
* The migration convention already encoded in method names should become real rather than aspirational

## Considered Options

* **Fail closed** — throw when a required `{Type}_vN_to_vN+1` method is missing; do not update `schemaVersion`
* **Identity default** — treat a missing method as a no-op but still bump the version (the previous behaviour)
* **External migration registry** — a separate map of functions, more flexible but a larger refactor

## Decision Outcome

Chosen option: **fail closed**. `migrateEvent` throws if any step between `fromVersion` and `toVersion` has no method. `schemaVersion` is written only after every step succeeds.

### How to add a migration

1. Increment `SCHEMA_VERSIONS[type].current` in `backend/src/eventSourcing/eventSerializer.js`.
2. Add an instance method named `{Type}_v{from}_to_v{to}` that returns the transformed event. See `PaymentSent_v1_to_v2` as the working example (v1 events gain `data.asset = 'XLM'`).
3. Add a deserialize test that asserts the new fields.

Audit note: `SCHEMA_VERSIONS` values were all `1` from introduction until this ADR. No stored event was ever silently relabeled, so no backfill is required. The first real bump is `PaymentSent` 1 → 2, covered by `PaymentSent_v1_to_v2`.

### Positive Consequences

* A forgotten migration method fails tests and runtime deserialize instead of corrupting aggregate state
* The method-name convention is documented and proven by an example

### Negative Consequences

* Deserialize of an unknown gap is a hard error; operators must ship the missing method (or a one-off backfill) before those events can be replayed
