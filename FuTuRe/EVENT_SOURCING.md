# Event Sourcing System

A comprehensive event sourcing implementation for the Stellar Remittance Platform, providing audit trails, replay capabilities, and event-driven architecture.

## Architecture

### Core Components

1. **EventStore** - Persistent event storage with JSONL format
2. **EventSerializer** - Event serialization with versioning support
3. **EventReplayer** - State reconstruction from events
4. **ProjectionManager** - Read model generation from events
5. **EventArchiver** - Old event archival and restoration
6. **EventAnalytics** - Event metrics and statistics
7. **EventMonitor** - Central event orchestration

## Features

### Event Store Architecture

- **Append-only log**: Events stored in JSONL format per aggregate
- **Immutable events**: Once written, events cannot be modified
- **Metadata tracking**: Timestamps, versions, and custom metadata
- **Efficient retrieval**: Fast event lookup by aggregate ID

```javascript
// Append an event
const event = await eventStore.append('account-123', {
  type: 'AccountCreated',
  data: { publicKey: 'GXYZ...' },
  version: 1
});

// Retrieve events
const events = await eventStore.getEvents('account-123');
```

### Event Serialization

- **Schema versioning**: Track event schema versions
- **Migration support**: Automatic event migration between versions
- **JSON compatibility**: Full JSON serialization support

```javascript
// Serialize with version
const serialized = eventSerializer.serialize({
  type: 'PaymentSent',
  data: { amount: 100 }
});

// Deserialize with automatic migration
const event = eventSerializer.deserialize(serialized);
```

### Event Replay

- **Full replay**: Reconstruct complete state from events
- **Point-in-time replay**: Restore state at specific version or timestamp
- **Snapshot optimization**: Use snapshots to skip old events

```javascript
// Replay to current state
const state = await eventReplayer.replay('account-123');

// Replay to specific version
const pastState = await eventReplayer.replay('account-123', 5);

// Replay to point in time
const historicalState = await eventReplayer.replayToPoint('account-123', '2024-01-01T00:00:00Z');
```

### Event Versioning

Events support semantic versioning:

```javascript
{
  type: 'PaymentSent',
  version: 1,
  schemaVersion: 1,
  data: { ... }
}
```

### Event Projections

Read models built from events:

- **account-summary**: Account status and balance information
- **payment-history**: Complete payment transaction log

```javascript
// Get projection
const summary = await eventMonitor.getProjection('account-summary');
// Returns: { accounts: { 'agg-1': { status: 'funded', ... } } }
```

### Event Monitoring

Central event orchestration with:

- **Event publishing**: Publish events with automatic persistence
- **Listener subscriptions**: React to events in real-time
- **Projection updates**: Automatic read model updates
- **Metrics recording**: Track event occurrences

```javascript
// Subscribe to events
eventMonitor.subscribe(async (event) => {
  console.log('Event occurred:', event.type);
});

// Publish event
await eventMonitor.publishEvent('account-123', {
  type: 'PaymentSent',
  data: { destination: 'GABC...', amount: '100' }
});
```

### Event Archiving

Manage event storage with archival:

```javascript
// Archive events older than 30 days
const result = await eventArchiver.archiveOldEvents(30);
// Returns: { events: 1500, aggregates: 45 }

// Restore from archive
const archived = await eventArchiver.getArchivedEvents('account-123');
```

### Event Analytics

Track and analyze event patterns:

```javascript
// Record metric
await eventAnalytics.recordMetric('event_PaymentSent', 1, { aggregateId: 'agg-1' });

// Get event statistics
const stats = await eventMonitor.getEventStats();
// Returns: { event_PaymentSent: { count: 42, lastOccurrence: '2024-03-25T...' } }

// Get analytics for event type
const analytics = await eventMonitor.getAnalytics('PaymentSent');
```

## API Endpoints

### Event History
```
GET /api/events/history/:aggregateId
```
Get all events for an aggregate.

### Aggregate State
```
GET /api/events/state/:aggregateId
```
Get current state by replaying all events.

### Event Replay
```
GET /api/events/replay/:aggregateId?toVersion=5
```
Replay events to specific version.

### Projections
```
GET /api/events/projection/:name
```
Get a read model projection (e.g., `account-summary`, `payment-history`).

### Analytics
```
GET /api/events/analytics/:eventType
GET /api/events/stats
```
Get event statistics and analytics.

### Archive
```
POST /api/events/archive
```
Archive old events. Request body:
```json
{
  "olderThanDays": 30
}
```

### All Events
```
GET /api/events/all?limit=1000&offset=0
```
Get all events with pagination.

## Event Types

### AccountCreated
```javascript
{
  type: 'AccountCreated',
  data: {
    publicKey: 'GXYZ...',
    secretKey: 'SXYZ...'
  }
}
```

### AccountFunded
```javascript
{
  type: 'AccountFunded',
  data: {
    publicKey: 'GXYZ...'
  }
}
```

### BalanceChecked
```javascript
{
  type: 'BalanceChecked',
  data: {
    balances: [
      { asset: 'XLM', balance: '100.00' }
    ]
  }
}
```

### PaymentSent
```javascript
{
  type: 'PaymentSent',
  data: {
    destination: 'GABC...',
    amount: '50.00',
    hash: 'tx-hash-123'
  }
}
```

## Storage Structure

```
data/
├── events/
│   ├── account-123.jsonl
│   ├── account-456.jsonl
│   └── ...
├── snapshots/
│   ├── account-123.json
│   ├── account-456.json
│   └── ...
├── projections/
│   ├── account-summary.json
│   ├── payment-history.json
│   └── ...
├── metrics/
│   ├── event_AccountCreated.jsonl
│   ├── event_PaymentSent.jsonl
│   └── ...
└── archive/
    ├── account-123.jsonl.1711353600000.archive
    └── ...
```

## Usage Examples

### Complete Workflow

```javascript
import { eventMonitor, eventReplayer } from './eventSourcing/index.js';

// Initialize
await eventMonitor.initialize();

// Publish events
await eventMonitor.publishEvent('account-123', {
  type: 'AccountCreated',
  data: { publicKey: 'GXYZ...', secretKey: 'SXYZ...' }
});

await eventMonitor.publishEvent('account-123', {
  type: 'PaymentSent',
  data: { destination: 'GABC...', amount: '100' }
});

// Get current state
const state = await eventMonitor.getAggregateState('account-123');
console.log(state);
// { publicKey: 'GXYZ...', lastPayment: { ... } }

// Get projections
const summary = await eventMonitor.getProjection('account-summary');
console.log(summary.accounts['account-123']);

// Get statistics
const stats = await eventMonitor.getEventStats();
console.log(stats);
```

### Audit Trail

```javascript
// Get complete audit trail
const events = await eventMonitor.getEventHistory('account-123');

events.forEach(event => {
  console.log(`${event.timestamp}: ${event.type}`);
  console.log(`Data: ${JSON.stringify(event.data)}`);
});
```

### Time Travel

```javascript
// Restore state at specific point in time
const pastState = await eventReplayer.replayToPoint(
  'account-123',
  '2024-03-20T12:00:00Z'
);

console.log('Account state on March 20:', pastState);
```

## Performance Considerations

- **Snapshots**: Use snapshots for aggregates with many events
- **Archival**: Archive events older than 30 days to reduce active storage
- **Pagination**: Use limit/offset for large event queries
- **Projections**: Pre-computed read models for fast queries

## Testing

Run the event sourcing tests:

```bash
npm test -- eventSourcing.test.js
```

## Future Enhancements

- Event deduplication
- Distributed event store
- Event encryption
- Advanced analytics and reporting
- Event streaming (Kafka/RabbitMQ integration)
- CQRS pattern implementation
