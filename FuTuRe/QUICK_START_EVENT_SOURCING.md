# Event Sourcing Quick Start Guide

## Basic Usage

### Publishing Events

```javascript
import { eventMonitor } from './eventSourcing/index.js';

// Initialize
await eventMonitor.initialize();

// Publish an event
await eventMonitor.publishEvent('account-123', {
  type: 'PaymentSent',
  data: {
    destination: 'GABC...',
    amount: '100'
  }
});
```

### Getting State

```javascript
// Get current state
const state = await eventMonitor.getAggregateState('account-123');
console.log(state);
// { publicKey: '...', lastPayment: { ... } }
```

### Event History

```javascript
// Get all events for an aggregate
const events = await eventMonitor.getEventHistory('account-123');
events.forEach(e => {
  console.log(`${e.timestamp}: ${e.type}`);
});
```

### Projections

```javascript
// Get read model
const summary = await eventMonitor.getProjection('account-summary');
console.log(summary.accounts['account-123']);
```

### Analytics

```javascript
// Get event statistics
const stats = await eventMonitor.getEventStats();
console.log(stats);
// { event_PaymentSent: { count: 42, lastOccurrence: '...' } }
```

## API Examples

### Get Event History
```bash
curl http://localhost:3001/api/events/history/account-123
```

### Get Current State
```bash
curl http://localhost:3001/api/events/state/account-123
```

### Get Projection
```bash
curl http://localhost:3001/api/events/projection/account-summary
```

### Get Statistics
```bash
curl http://localhost:3001/api/events/stats
```

### Archive Old Events
```bash
curl -X POST http://localhost:3001/api/events/archive \
  -H "Content-Type: application/json" \
  -d '{"olderThanDays": 30}'
```

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

### PaymentSent
```javascript
{
  type: 'PaymentSent',
  data: {
    destination: 'GABC...',
    amount: '50.00',
    hash: 'tx-hash'
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

## Advanced Usage

### Replay to Specific Version
```javascript
import { eventReplayer } from './eventSourcing/index.js';

const state = await eventReplayer.replay('account-123', 5);
```

### Custom Projections
```javascript
import { projectionManager } from './eventSourcing/index.js';

projectionManager.registerProjection('custom-view', (projection, event) => {
  if (event.type === 'PaymentSent') {
    projection.totalSent = (projection.totalSent || 0) + parseFloat(event.data.amount);
  }
  return projection;
});
```

### Event Listeners
```javascript
eventMonitor.subscribe(async (event) => {
  console.log('Event:', event.type);
  // React to events in real-time
});
```

## Testing

```bash
# Run event sourcing tests
npm test -- eventSourcing.test.js

# Run all tests
npm test
```

## Storage

Events are stored in `data/` directory:
- `data/events/` - Event logs
- `data/snapshots/` - Aggregate snapshots
- `data/projections/` - Read models
- `data/metrics/` - Event metrics
- `data/archive/` - Archived events

## Performance Tips

1. Use snapshots for aggregates with many events
2. Archive events older than 30 days
3. Use pagination for large queries
4. Pre-compute projections for frequent queries
5. Monitor event metrics regularly

## Troubleshooting

### Events not appearing
- Check that `eventMonitor.initialize()` was called
- Verify aggregate ID is correct
- Check `data/events/` directory exists

### State not updating
- Ensure event type is recognized in `eventReplayer.applyEvent()`
- Check event data structure matches expected format

### Projections empty
- Verify projection handler is registered
- Check events are being published
- Review projection logic

## Documentation

- Full documentation: `EVENT_SOURCING.md`
- Implementation details: `IMPLEMENTATION_SUMMARY.md`
- API docs: http://localhost:3001/api-docs
