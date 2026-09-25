import eventStore from './eventStore.js';

class EventReplayer {
  async replay(aggregateId, toVersion = null) {
    const snapshot = await eventStore.getSnapshot(aggregateId);
    let state = snapshot ? snapshot.state : {};
    let fromVersion = snapshot ? snapshot.version : 0;

    for await (const event of eventStore.streamEvents(aggregateId, { fromVersion })) {
      if (toVersion && event.version > toVersion) continue;
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
    const point = new Date(timestamp);

    let state = {};
    for await (const event of eventStore.streamEvents(aggregateId)) {
      if (new Date(event.timestamp) > point) continue;
      state = this.applyEvent(state, event);
    }

    return state;
  }
}

export default new EventReplayer();
