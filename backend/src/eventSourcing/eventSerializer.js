/**
 * Schema versions and event serialization.
 *
 * How to bump a schema version
 * ----------------------------
 * 1. Increment `SCHEMA_VERSIONS[type].current`.
 * 2. Add an instance method named `{Type}_v{from}_to_v{to}` that receives the
 *    event object and returns the transformed event. Example:
 *    `PaymentSent_v1_to_v2(event)` — see below.
 * 3. Cover the new method with a deserialize test that asserts the transformed
 *    fields. `migrateEvent` throws if a required step is missing, so a bump
 *    without a method will fail closed rather than silently relabel events.
 *
 * See docs/adr/0005-event-schema-migrations.md.
 */
export const SCHEMA_VERSIONS = {
  AccountCreated: { current: 1 },
  PaymentSent: { current: 2 },
  BalanceChecked: { current: 1 },
  AccountFunded: { current: 1 },
};

export class EventSerializer {
  serialize(event) {
    const schema = SCHEMA_VERSIONS[event.type];
    if (!schema) {
      throw new Error(`Unknown event type: ${event.type}`);
    }

    return {
      ...event,
      schemaVersion: schema.current,
    };
  }

  deserialize(serialized) {
    const schema = SCHEMA_VERSIONS[serialized.type];
    if (!schema) {
      throw new Error(`Unknown event type: ${serialized.type}`);
    }

    const schemaVersion = serialized.schemaVersion || 1;
    if (schemaVersion !== schema.current) {
      return this.migrateEvent(serialized, schemaVersion, schema.current);
    }

    return serialized;
  }

  /**
   * Walk `fromVersion` → `toVersion` applying `{type}_vN_to_vN+1` methods.
   * Throws if any required step is missing so the event is never stamped
   * with a schema version it was not actually migrated to.
   */
  migrateEvent(event, fromVersion, toVersion) {
    if (fromVersion > toVersion) {
      throw new Error(
        `Cannot migrate ${event.type} from v${fromVersion} to older v${toVersion}`
      );
    }

    let migratedEvent = { ...event };

    for (let v = fromVersion; v < toVersion; v++) {
      const migrationKey = `${event.type}_v${v}_to_v${v + 1}`;
      const migrate = this[migrationKey];
      if (typeof migrate !== 'function') {
        throw new Error(
          `Missing schema migration ${migrationKey} (required to migrate ${event.type} from v${fromVersion} to v${toVersion})`
        );
      }
      migratedEvent = migrate.call(this, migratedEvent);
    }

    migratedEvent.schemaVersion = toVersion;
    return migratedEvent;
  }

  /**
   * Example migration: PaymentSent v1 stored a bare amount; v2 always includes
   * an asset code (default XLM for historical events).
   */
  PaymentSent_v1_to_v2(event) {
    return {
      ...event,
      data: {
        ...event.data,
        asset: event.data?.asset ?? 'XLM',
      },
    };
  }

  toJSON(event) {
    return JSON.stringify(this.serialize(event));
  }

  fromJSON(json) {
    return this.deserialize(JSON.parse(json));
  }
}

export default new EventSerializer();
