import eventStore from './eventStore.js';

/**
 * Bump whenever `applyEvent` changes how state is folded. Snapshots taken by an
 * older reducer are then ignored and the aggregate is rebuilt from events.
 */
export const REDUCER_VERSION = 1;

class EventReplayer {
  /**
   * Rebuild aggregate state from the latest snapshot at or below `toVersion`
   * plus the events after it (#1362).
   */
  async replay(aggregateId, toVersion = null) {
    const snapshot = await eventStore.getSnapshot(aggregateId, {
      maxVersion: toVersion,
      reducerVersion: REDUCER_VERSION,
    });
    let state = snapshot ? snapshot.state : {};
    let fromVersion = snapshot ? snapshot.version : 0;

    for await (const event of eventStore.streamEvents(aggregateId, { fromVersion })) {
      if (toVersion && event.version > toVersion) continue;
    const fromVersion = snapshot ? snapshot.version : 0;

    const events = await eventStore.getEvents(aggregateId, fromVersion, toVersion);
    for (const event of events) {
      state = this.applyEvent(state, event);
    }

    return state;
  }

  /**
   * Fold the aggregate up to `version` and persist the result as a snapshot.
   */
  async createSnapshot(aggregateId, version) {
    const state = await this.replay(aggregateId, version);
    await eventStore.saveSnapshot(aggregateId, state, version, REDUCER_VERSION);
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
            asset: event.data.asset,
            feeBump: event.data.feeBump,
            memoType: event.data.memoType,
            timestamp: event.timestamp
          }
        };

      default:
        return state;
    }
  }

  async replayToPoint(aggregateId, timestamp) {
    const point = new Date(timestamp);
    const events = await eventStore.getEvents(aggregateId);
    const pointEvents = events.filter(e => new Date(e.timestamp) <= new Date(timestamp));

    let state = {};
    for await (const event of eventStore.streamEvents(aggregateId)) {
      if (new Date(event.timestamp) > point) continue;
      state = this.applyEvent(state, event);
    }

    return state;
  }
}

export default new EventReplayer();
