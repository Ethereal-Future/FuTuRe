/**
 * Service Communication
 * Inter-service communication patterns
 */

export class ServiceCommunication {
  constructor() {
    this.services = new Map();
    this.messageQueue = [];
  }

  registerService(name, service) {
    this.services.set(name, service);
    return this;
  }

  async callService(fromService, toService, method, data) {
    const service = this.services.get(toService);
    if (!service) {
      throw new Error(`Service ${toService} not found`);
    }

    return {
      timestamp: Date.now(),
      from: fromService,
      to: toService,
      method,
      status: 'success',
      data: { ...data, processed: true },
    };
  }

  async publishEvent(serviceName, eventType, payload) {
    const event = {
      timestamp: Date.now(),
      service: serviceName,
      type: eventType,
      payload,
    };

    this.messageQueue.push(event);
    return event;
  }

  async subscribeToEvent(serviceName, eventType, handler) {
    return {
      service: serviceName,
      eventType,
      handler: handler.name || 'anonymous',
      subscribed: true,
    };
  }

  getMessageQueue() {
    return this.messageQueue;
  }

  clearMessageQueue() {
    this.messageQueue = [];
  }
}

export const createServiceCommunication = () => new ServiceCommunication();
