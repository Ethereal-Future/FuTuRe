/**
 * Push notification infrastructure.
 * Stores device tokens and dispatches notifications.
 * In production, swap _send() to call FCM/APNs.
 */
class PushNotifications {
  constructor() {
    // userId -> Set of { token, platform, deviceId }
    this.deviceTokens = new Map();
    // in-memory log for testing / audit
    this.sentLog = [];
  }

  registerDevice(userId, deviceId, token, platform) {
    if (!this.deviceTokens.has(userId)) this.deviceTokens.set(userId, new Map());
    this.deviceTokens.get(userId).set(deviceId, { token, platform, registeredAt: new Date() });
    return { registered: true };
  }

  unregisterDevice(userId, deviceId) {
    this.deviceTokens.get(userId)?.delete(deviceId);
    return { unregistered: true };
  }

  async notify(userId, { title, body, data = {} }) {
    const devices = this.deviceTokens.get(userId);
    if (!devices || devices.size === 0) return { sent: 0 };

    const results = [];
    for (const [deviceId, info] of devices) {
      const result = await this._send(info.token, info.platform, { title, body, data });
      results.push({ deviceId, ...result });
    }

    this.sentLog.push({ userId, title, body, data, sentAt: new Date(), results });
    return { sent: results.length, results };
  }

  /** Stub — replace with real FCM/APNs call */
  async _send(token, platform, payload) {
    // TODO: integrate firebase-admin (FCM) or node-apn (APNs)
    return { success: true, token: token.slice(0, 8) + '…', platform };
  }

  getLog(userId) {
    return this.sentLog.filter(e => e.userId === userId);
  }
}

export default new PushNotifications();
