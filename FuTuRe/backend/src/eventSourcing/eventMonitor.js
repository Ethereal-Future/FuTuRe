import eventStore from './eventStore.js';
import eventReplayer from './eventReplayer.js';
import projectionManager from './projectionManager.js';
import eventAnalytics from './eventAnalytics.js';

class EventMonitor {
  constructor() {
    this.listeners = [];
    this.initialized = false;
  }

  async initialize() {
    await eventStore.initialize();
    await projectionManager.initialize();
    await eventAnalytics.initialize();
    this.initialized = true;
  }

  subscribe(handler) {
    this.listeners.push(handler);
  }

  async publishEvent(aggregateId, event) {
    if (!this.initialized) await this.initialize();

    const storedEvent = await eventStore.append(aggregateId, event);

    // Record metric
    await eventAnalytics.recordMetric(`event_${event.type}`, 1, { aggregateId });

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        await listener(storedEvent);
      } catch (error) {
        console.error('Listener error:', error);
      }
    }

    // Update projections
    await this.updateProjections(aggregateId, [storedEvent]);

    return storedEvent;
  }

  async updateProjections(aggregateId, events) {
    const projectionNames = ['account-summary', 'payment-history'];

    for (const name of projectionNames) {
      try {
        await projectionManager.project(name, events);
      } catch (error) {
        console.error(`Projection update failed for ${name}:`, error);
      }
    }
  }

  async getEventHistory(aggregateId) {
    return eventStore.getEvents(aggregateId);
  }

  async getAggregateState(aggregateId) {
    return eventReplayer.replay(aggregateId);
  }

  async getProjection(name) {
    return projectionManager.getProjection(name);
  }

  async getAnalytics(eventType) {
    return eventAnalytics.getAnalytics(eventType);
  }

  async getEventStats() {
    return eventAnalytics.getEventStats();
  }
}

export default new EventMonitor();
