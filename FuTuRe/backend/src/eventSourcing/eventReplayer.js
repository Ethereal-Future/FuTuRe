import eventStore from './eventStore.js';

class EventReplayer {
  async replay(aggregateId, toVersion = null) {
    const snapshot = await eventStore.getSnapshot(aggregateId);
    let state = snapshot ? snapshot.state : {};
    let fromVersion = snapshot ? snapshot.version : 0;

    const events = await eventStore.getEvents(aggregateId, fromVersion);
    const filteredEvents = toVersion 
      ? events.filter(e => e.version <= toVersion)
      : events;

    for (const event of filteredEvents) {
      state = this.applyEvent(state, event);
    }

    return state;
  }

  applyEvent(state, event) {
    switch (event.type) {
      case 'AccountCreated':
        return {
          ...state,
          publicKey: event.data.publicKey,
          secretKey: event.data.secretKey,
          createdAt: event.timestamp
        };

      case 'AccountFunded':
        return {
          ...state,
          funded: true,
          fundedAt: event.timestamp
        };

      case 'BalanceChecked':
        return {
          ...state,
          lastBalance: event.data.balances,
          lastBalanceCheck: event.timestamp
        };

      case 'PaymentSent':
        return {
          ...state,
          lastPayment: {
            destination: event.data.destination,
            amount: event.data.amount,
            hash: event.data.hash,
            timestamp: event.timestamp
          }
        };

      default:
        return state;
    }
  }

  async replayToPoint(aggregateId, timestamp) {
    const events = await eventStore.getEvents(aggregateId);
    const pointEvents = events.filter(e => new Date(e.timestamp) <= new Date(timestamp));
    
    let state = {};
    for (const event of pointEvents) {
      state = this.applyEvent(state, event);
    }

    return state;
  }
}

export default new EventReplayer();
