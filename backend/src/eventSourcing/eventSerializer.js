/**
 * Schema versions, upcasters and event serialization.
 *
 * Stored events are immutable: a row written as PaymentSent v1 stays v1 in the
 * database forever. Instead of migrating rows, every read runs the event
 * through a chain of *upcasters* (pure `data -> data` functions registered per
 * `(type, fromVersion)`) until it reaches `SCHEMA_VERSIONS[type].current`, then
 * validates the result against the latest Zod schema. Projections and the
 * replayer therefore only ever see the latest shape.
 *
 * How to bump a schema version
 * ----------------------------
 * 1. Increment `SCHEMA_VERSIONS[type].current`.
 * 2. `upcasters.register(type, previousCurrent, (data) => newData)`.
 * 3. Update `EVENT_SCHEMAS[type]` to describe the new latest shape.
 *
 * A missing step fails closed (throws) rather than relabeling the event with a
 * version it was never transformed into. See docs/adr/0005-event-schema-migrations.md.
 */
import { z } from 'zod';

export const SCHEMA_VERSIONS = {
  AccountCreated: { current: 1 },
  // v1: { destination, amount, hash }
  // v2: + asset
  // v3: + feeBump, memo, memoType
  PaymentSent: { current: 3 },
  BalanceChecked: { current: 1 },
  AccountFunded: { current: 1 },
};

const amount = z.union([z.string(), z.number()]);

/**
 * Latest-version payload schemas. `passthrough` keeps fields added by writers
 * that the schema does not (yet) describe. Fields introduced by schema
 * evolution carry the same defaults as their upcasters so a current-version
 * writer that omits an optional field still yields a complete event.
 */
export const EVENT_SCHEMAS = {
  AccountCreated: z.object({ publicKey: z.string() }).passthrough(),
  AccountFunded: z.object({}).passthrough(),
  BalanceChecked: z.object({ balances: z.unknown().optional() }).passthrough(),
  PaymentSent: z
    .object({
      destination: z.string().optional(),
      amount: amount.optional(),
      hash: z.string().optional(),
      asset: z.string().default('XLM'),
      feeBump: z.boolean().default(false),
      memo: z.string().nullable().default(null),
      memoType: z.string().nullable().default(null),
    })
    .passthrough(),
};

export class UpcasterRegistry {
  constructor() {
    this.upcasters = new Map();
  }

  static key(type, fromVersion) {
    return `${type}_v${fromVersion}_to_v${fromVersion + 1}`;
  }

  /**
   * Register the migration that lifts `type` payloads from `fromVersion` to
   * `fromVersion + 1`.
   * @param {string} type
   * @param {number} fromVersion
   * @param {(data: object) => object} upcaster
   */
  register(type, fromVersion, upcaster) {
    const key = UpcasterRegistry.key(type, fromVersion);
    if (this.upcasters.has(key)) {
      throw new Error(`Upcaster ${key} is already registered`);
    }
    this.upcasters.set(key, upcaster);
  }

  /**
   * Run `data` through every upcaster from `fromVersion` to `toVersion`.
   * Throws if any step is missing.
   */
  upcast(type, data, fromVersion, toVersion) {
    if (fromVersion > toVersion) {
      throw new Error(`Cannot migrate ${type} from v${fromVersion} to older v${toVersion}`);
    }

    let upcasted = data;
    for (let v = fromVersion; v < toVersion; v++) {
      const key = UpcasterRegistry.key(type, v);
      const upcaster = this.upcasters.get(key);
      if (!upcaster) {
        throw new Error(
          `Missing schema migration ${key} (required to migrate ${type} from v${fromVersion} to v${toVersion})`
        );
      }
      upcasted = upcaster(upcasted);
    }
    return upcasted;
  }
}

export const upcasters = new UpcasterRegistry();

export function registerUpcaster(type, fromVersion, upcaster) {
  upcasters.register(type, fromVersion, upcaster);
}

// ── Historical migrations ────────────────────────────────────────────────────

// v1 stored a bare amount; v2 always carries an asset code.
registerUpcaster('PaymentSent', 1, (data) => ({
  ...data,
  asset: data?.asset ?? 'XLM',
}));

// v3 records whether the payment was fee-bumped and its memo.
registerUpcaster('PaymentSent', 2, (data) => ({
  ...data,
  feeBump: data?.feeBump ?? false,
  memo: data?.memo ?? null,
  memoType: data?.memoType ?? null,
}));

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
   * Upcast `event.data` from `fromVersion` to `toVersion`. The input event is
   * never mutated. `schemaVersion` is stamped only after every step succeeds.
   */
  migrateEvent(event, fromVersion, toVersion) {
    const data = upcasters.upcast(event.type, event.data ?? {}, fromVersion, toVersion);
    return { ...event, data, schemaVersion: toVersion };
  }

  /**
   * Read path used by the event store: upcast a stored event to the latest
   * schema and validate it. Event types with no registered schema (e.g.
   * TransactionFetched, MultiSig*) pass through unchanged.
   *
   * @param {{ type: string, data: object, schemaVersion?: number }} event
   * @returns {object} the event in its latest shape
   */
  deserializeEvent(event) {
    const schema = SCHEMA_VERSIONS[event.type];
    if (!schema) return event;

    // Forward compatibility: an event written by a newer deployment (e.g.
    // mid rolling deploy) is read as-is. Schemas are passthrough, so fields
    // this version does not know about are preserved, and additive changes
    // still validate against the older schema.
    const upcasted = (event.schemaVersion || 1) > schema.current ? event : this.deserialize(event);
    const result = EVENT_SCHEMAS[event.type]?.safeParse(upcasted.data ?? {});
    if (result && !result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      throw new Error(
        `Event ${event.id ?? '(unsaved)'} (${event.type} v${upcasted.schemaVersion}) failed schema validation: ${issues}`
      );
    }

    return { ...upcasted, data: result ? result.data : upcasted.data };
  }

  /**
   * Schema version to persist alongside a newly written event.
   * @returns {number|undefined} undefined for unregistered event types
   */
  currentVersion(type) {
    return SCHEMA_VERSIONS[type]?.current;
  }

  toJSON(event) {
    return JSON.stringify(this.serialize(event));
  }

  fromJSON(json) {
    return this.deserialize(JSON.parse(json));
  }
}

export default new EventSerializer();
