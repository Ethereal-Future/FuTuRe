const SCHEMA_VERSIONS = {
  'AccountCreated': { current: 1 },
  'PaymentSent': { current: 1 },
  'BalanceChecked': { current: 1 },
  'AccountFunded': { current: 1 }
};

class EventSerializer {
  serialize(event) {
    const schema = SCHEMA_VERSIONS[event.type];
    if (!schema) {
      throw new Error(`Unknown event type: ${event.type}`);
    }

    return {
      ...event,
      schemaVersion: schema.current
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

  migrateEvent(event, fromVersion, toVersion) {
    // Migration logic for different schema versions
    let migratedEvent = { ...event };

    for (let v = fromVersion; v < toVersion; v++) {
      const migrationKey = `${event.type}_v${v}_to_v${v + 1}`;
      if (this[migrationKey]) {
        migratedEvent = this[migrationKey](migratedEvent);
      }
    }

    migratedEvent.schemaVersion = toVersion;
    return migratedEvent;
  }

  toJSON(event) {
    return JSON.stringify(this.serialize(event));
  }

  fromJSON(json) {
    return this.deserialize(JSON.parse(json));
  }
}

export default new EventSerializer();
