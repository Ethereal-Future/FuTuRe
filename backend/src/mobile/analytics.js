/**
 * Mobile analytics tracking.
 * Collects app events (screen views, actions, errors) per user/device.
 */
class MobileAnalytics {
  constructor() {
    this.events = [];
  }

  track(userId, deviceId, eventName, properties = {}) {
    const event = {
      userId,
      deviceId,
      event: eventName,
      properties,
      timestamp: new Date(),
    };
    this.events.push(event);
    return event;
  }

  getStats(userId) {
    const userEvents = this.events.filter(e => e.userId === userId);
    const counts = userEvents.reduce((acc, e) => {
      acc[e.event] = (acc[e.event] || 0) + 1;
      return acc;
    }, {});
    return { total: userEvents.length, counts };
  }

  getSummary() {
    const counts = this.events.reduce((acc, e) => {
      acc[e.event] = (acc[e.event] || 0) + 1;
      return acc;
    }, {});
    return { total: this.events.length, counts };
  }
}

export default new MobileAnalytics();
