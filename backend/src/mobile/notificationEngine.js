import { randomUUID } from 'crypto';
import logger from '../config/logger.js';

// Push provider responses that mean a device token will never work again
// (issue #1384). Such tokens are pruned from `UserDevice` after a broadcast.
export const FCM_EXPIRED_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
]);
export const APNS_UNREGISTERED_STATUS = 410;
const FCM_MULTICAST_LIMIT = 500;

// Loaded lazily so the engine can be constructed (e.g. in unit tests)
// without a configured database connection.
async function loadPrisma() {
  const { default: prisma } = await import('../db/client.js');
  return prisma;
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function isApnsPlatform(platform) {
  return ['ios', 'apns'].includes(String(platform ?? '').toLowerCase());
}

/** Short, non-reversible token label for logs — never log full push tokens. */
function tokenLabel(token) {
  return `${String(token).slice(0, 8)}…`;
}

function toFcmData(data = {}) {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
}

function hashToBucket(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash % 10000) / 10000;
}

function renderTemplate(template, payload) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = key.split('.').reduce((acc, part) => acc?.[part], payload);
    return value == null ? '' : String(value);
  });
}

class NotificationEngine {
  /**
   * @param {{ fcm?: object, apns?: object, db?: object }} [options]
   *   `fcm` is a Firebase Admin `messaging()` instance (uses `sendEachForMulticast`);
   *   `apns` exposes `send(token, payload)` resolving to the HTTP/2 `{ status, reason }`;
   *   `db` defaults to the shared Prisma client.
   */
  constructor({ fcm = null, apns = null, db = null } = {}) {
    this.fcm = fcm;
    this.apns = apns;
    this.db = db;
    this.templates = new Map();
    this.userProfiles = new Map();
    this.userConsent = new Map();
    this.deliveryLog = [];
    this.analytics = {
      deliveries: 0,
      opens: 0,
      clicks: 0,
      bounces: 0,
      byChannel: {},
      byVariant: {},
      complianceBlocked: 0,
    };
    this.performance = {
      totalMs: 0,
      sends: 0,
      maxMs: 0,
      minMs: Number.POSITIVE_INFINITY,
    };
    this.deliveryDedup = new Map();
  }

  registerTemplate(templateId, template) {
    if (!template?.title || !template?.body) {
      throw new Error('Template must include title and body');
    }
    this.templates.set(templateId, template);
  }

  registerUserProfile(userId, profile = {}) {
    this.userProfiles.set(userId, {
      timezoneOffsetMinutes: profile.timezoneOffsetMinutes ?? 0,
      preferredChannels: profile.preferredChannels ?? ['push', 'in_app'],
      engagementByHour: profile.engagementByHour ?? {},
      attributes: profile.attributes ?? {},
    });
  }

  setCompliance(userId, compliance = {}) {
    this.userConsent.set(userId, {
      marketingOptIn: compliance.marketingOptIn ?? true,
      unsubscribed: compliance.unsubscribed ?? false,
      quietHours: compliance.quietHours ?? { start: 22, end: 7 },
      allowedRegions: compliance.allowedRegions ?? [],
    });
  }

  routeNotification(userId, payload, channels = ['push', 'email', 'sms', 'in_app']) {
    const profile = this.userProfiles.get(userId) ?? {};
    const preferred = profile.preferredChannels ?? channels;
    const urgency = payload.urgency ?? 'normal';

    if (urgency === 'critical' && channels.includes('push')) return 'push';
    for (const channel of preferred) {
      if (channels.includes(channel)) return channel;
    }
    return channels[0] ?? 'in_app';
  }

  personalize(templateId, userId, data = {}) {
    const template = this.templates.get(templateId);
    if (!template) throw new Error(`Unknown template: ${templateId}`);
    const profile = this.userProfiles.get(userId) ?? { attributes: {} };
    const payload = { ...data, user: profile.attributes };

    return {
      title: renderTemplate(template.title, payload),
      body: renderTemplate(template.body, payload),
    };
  }

  chooseVariant(experimentId, userId, variants) {
    if (!Array.isArray(variants) || variants.length === 0) {
      throw new Error('Variants are required');
    }
    const totalWeight = variants.reduce((acc, item) => acc + (item.weight ?? 1), 0);
    let pointer = hashToBucket(`${experimentId}:${userId}`) * totalWeight;
    for (const variant of variants) {
      pointer -= (variant.weight ?? 1);
      if (pointer <= 0) {
        return variant;
      }
    }
    return variants[variants.length - 1];
  }

  optimizeDelivery(userId, baseDelivery = {}) {
    const profile = this.userProfiles.get(userId);
    const now = new Date();
    const suggestedHour = this.findBestHour(profile?.engagementByHour ?? {});
    const date = new Date(baseDelivery.sendAt ?? now);
    date.setUTCHours((suggestedHour - (profile?.timezoneOffsetMinutes ?? 0) / 60 + 24) % 24, 0, 0, 0);
    if (date < now) date.setUTCDate(date.getUTCDate() + 1);
    return { sendAt: date.toISOString(), dedupeWindowMs: baseDelivery.dedupeWindowMs ?? 10 * 60 * 1000 };
  }

  findBestHour(engagementByHour) {
    let bestHour = 9;
    let bestValue = -1;
    for (let hour = 0; hour < 24; hour += 1) {
      const value = Number(engagementByHour[hour] ?? 0);
      if (value > bestValue) {
        bestValue = value;
        bestHour = hour;
      }
    }
    return bestHour;
  }

  checkCompliance(userId, payload, now = new Date()) {
    const rules = this.userConsent.get(userId) ?? {};
    if (rules.unsubscribed) return { allowed: false, reason: 'unsubscribed' };
    if (payload.type === 'marketing' && rules.marketingOptIn === false) {
      return { allowed: false, reason: 'marketing_opt_out' };
    }

    const hour = now.getUTCHours();
    const quiet = rules.quietHours ?? { start: 22, end: 7 };
    const inQuietHours = quiet.start > quiet.end
      ? hour >= quiet.start || hour < quiet.end
      : hour >= quiet.start && hour < quiet.end;

    if (inQuietHours && payload.urgency !== 'critical') {
      return { allowed: false, reason: 'quiet_hours' };
    }

    if (rules.allowedRegions?.length > 0 && payload.region && !rules.allowedRegions.includes(payload.region)) {
      return { allowed: false, reason: 'region_restricted' };
    }
    return { allowed: true };
  }

  async send(userId, config) {
    const startedAt = Date.now();
    const compliance = this.checkCompliance(userId, config);
    if (!compliance.allowed) {
      this.analytics.complianceBlocked += 1;
      return { delivered: false, reason: compliance.reason };
    }

    const optimized = this.optimizeDelivery(userId, config.delivery ?? {});
    const dedupeKey = `${userId}:${config.templateId}:${config.dedupeKey ?? ''}`;
    const previous = this.deliveryDedup.get(dedupeKey);
    const now = Date.now();
    if (previous && now - previous < optimized.dedupeWindowMs) {
      return { delivered: false, reason: 'deduplicated' };
    }
    this.deliveryDedup.set(dedupeKey, now);

    const variant = config.experiment
      ? this.chooseVariant(config.experiment.id, userId, config.experiment.variants)
      : { id: 'default' };

    const content = this.personalize(config.templateId, userId, {
      ...config.data,
      variant: variant.id,
    });
    const channel = this.routeNotification(userId, config, config.channels);

    const delivery = {
      id: `delivery_${randomUUID()}`,
      userId,
      channel,
      variantId: variant.id,
      content,
      scheduledAt: optimized.sendAt,
      deliveredAt: new Date().toISOString(),
      status: 'delivered',
    };

    this.deliveryLog.push(delivery);
    this.analytics.deliveries += 1;
    this.analytics.byChannel[channel] = (this.analytics.byChannel[channel] ?? 0) + 1;
    this.analytics.byVariant[variant.id] = (this.analytics.byVariant[variant.id] ?? 0) + 1;

    const elapsed = Date.now() - startedAt;
    this.performance.totalMs += elapsed;
    this.performance.sends += 1;
    this.performance.maxMs = Math.max(this.performance.maxMs, elapsed);
    this.performance.minMs = Math.min(this.performance.minMs, elapsed);

    return { delivered: true, delivery };
  }

  /** Wire in real push providers (Firebase Admin messaging, APNS HTTP/2 client). */
  configurePushTransports({ fcm, apns } = {}) {
    if (fcm !== undefined) this.fcm = fcm;
    if (apns !== undefined) this.apns = apns;
  }

  async getDb() {
    if (!this.db) this.db = await loadPrisma();
    return this.db;
  }

  /** Persist (or move) a push token for a user's device. */
  async registerPushToken(userId, deviceId, token, platform) {
    if (!userId || !deviceId || !token) throw new Error('userId, deviceId and token are required');
    const db = await this.getDb();
    return db.userDevice.upsert({
      where: { token },
      create: { userId, deviceId, token, platform },
      update: { userId, deviceId, platform },
    });
  }

  /** Broadcast a push to every registered device of `userIds`, pruning dead tokens. */
  async broadcastPush(userIds, payload) {
    const db = await this.getDb();
    const devices = await db.userDevice.findMany({
      where: { userId: { in: userIds } },
      select: { token: true, platform: true },
    });
    return this.sendPushBatch(devices, payload);
  }

  /**
   * Deliver one push payload to many devices over FCM (multicast) and APNS.
   * A failure for one token never stops delivery to the others. Tokens the
   * providers report as expired / unregistered are removed from the database
   * in a single batch query afterwards (issue #1384).
   *
   * @param {Array<{ token: string, platform: string }>} devices
   * @param {{ title: string, body: string, data?: object }} payload
   * @returns {Promise<{ successCount: number, failureCount: number, prunedTokens: string[],
   *   failures: Array<{ token: string, provider: string, code: string }> }>}
   */
  async sendPushBatch(devices, payload) {
    const apnsTokens = [];
    const fcmTokens = [];
    for (const device of devices ?? []) {
      if (!device?.token) continue;
      (isApnsPlatform(device.platform) ? apnsTokens : fcmTokens).push(device.token);
    }

    const summary = { successCount: 0, failureCount: 0, prunedTokens: [], failures: [] };
    const expiredTokens = new Set();
    const fail = (token, provider, code, expired) => {
      summary.failureCount += 1;
      summary.failures.push({ token, provider, code });
      if (expired) expiredTokens.add(token);
    };

    await Promise.all([
      this.sendFcm(fcmTokens, payload, summary, fail),
      this.sendApns(apnsTokens, payload, summary, fail),
    ]);

    if (summary.failures.length > 0) {
      logger.warn('push.delivery.failures', {
        failureCount: summary.failureCount,
        failures: summary.failures.map((f) => ({ ...f, token: tokenLabel(f.token) })),
      });
    }

    summary.prunedTokens = await this.pruneExpiredTokens([...expiredTokens]);
    return summary;
  }

  async sendFcm(tokens, payload, summary, fail) {
    if (tokens.length === 0) return;
    if (!this.fcm) {
      tokens.forEach((token) => fail(token, 'fcm', 'transport/not-configured', false));
      return;
    }
    for (const batch of chunk(tokens, FCM_MULTICAST_LIMIT)) {
      let response;
      try {
        response = await this.fcm.sendEachForMulticast({
          tokens: batch,
          notification: { title: payload.title, body: payload.body },
          data: toFcmData(payload.data),
        });
      } catch (err) {
        // Whole-batch transport failure: nothing here says the tokens are dead.
        batch.forEach((token) => fail(token, 'fcm', err?.code ?? 'transport/error', false));
        continue;
      }
      // Firebase returns `responses` in the same order as `tokens`.
      batch.forEach((token, i) => {
        const result = response?.responses?.[i];
        if (result?.success) {
          summary.successCount += 1;
          return;
        }
        const code = result?.error?.code ?? 'unknown';
        fail(token, 'fcm', code, FCM_EXPIRED_TOKEN_CODES.has(code));
      });
    }
  }

  async sendApns(tokens, payload, summary, fail) {
    if (tokens.length === 0) return;
    if (!this.apns) {
      tokens.forEach((token) => fail(token, 'apns', 'transport/not-configured', false));
      return;
    }
    const aps = { alert: { title: payload.title, body: payload.body } };
    const results = await Promise.allSettled(
      tokens.map((token) => this.apns.send(token, { aps, ...(payload.data ?? {}) })),
    );
    results.forEach((result, i) => {
      const token = tokens[i];
      // Clients may resolve with the HTTP/2 response or reject with an error carrying it.
      const res = result.status === 'fulfilled' ? result.value : result.reason;
      const status = Number(res?.status ?? res?.statusCode);
      if (result.status === 'fulfilled' && (!status || (status >= 200 && status < 300))) {
        summary.successCount += 1;
        return;
      }
      const reason = res?.reason ?? res?.body?.reason ?? res?.message ?? 'unknown';
      const code = status ? `${status} ${reason}` : reason;
      fail(token, 'apns', code, status === APNS_UNREGISTERED_STATUS);
    });
  }

  /**
   * Remove expired device tokens in one query. Errors are logged rather
   * than thrown so pruning can never fail a delivery that already happened.
   *
   * @param {string[]} expiredTokens
   * @returns {Promise<string[]>} The tokens that were pruned.
   */
  async pruneExpiredTokens(expiredTokens) {
    if (!expiredTokens?.length) return [];
    try {
      const db = await this.getDb();
      const { count } = await db.userDevice.deleteMany({ where: { token: { in: expiredTokens } } });
      logger.info('push.tokens.pruned', {
        count,
        tokens: expiredTokens.map(tokenLabel),
      });
      return expiredTokens;
    } catch (err) {
      logger.error('push.tokens.pruneFailed', {
        error: err?.message,
        tokens: expiredTokens.map(tokenLabel),
      });
      return [];
    }
  }

  trackInteraction(deliveryId, type) {
    const found = this.deliveryLog.find(entry => entry.id === deliveryId);
    if (!found) return { tracked: false };
    if (type === 'open') this.analytics.opens += 1;
    if (type === 'click') this.analytics.clicks += 1;
    if (type === 'bounce') this.analytics.bounces += 1;
    return { tracked: true };
  }

  getAnalytics() {
    const ctr = this.analytics.opens === 0 ? 0 : this.analytics.clicks / this.analytics.opens;
    return {
      ...this.analytics,
      ctr,
      conversionProxy: this.analytics.deliveries === 0
        ? 0
        : (this.analytics.clicks / this.analytics.deliveries),
    };
  }

  getPerformanceMetrics() {
    const avg = this.performance.sends === 0 ? 0 : this.performance.totalMs / this.performance.sends;
    return {
      sends: this.performance.sends,
      avgLatencyMs: avg,
      maxLatencyMs: this.performance.maxMs,
      minLatencyMs: Number.isFinite(this.performance.minMs) ? this.performance.minMs : 0,
    };
  }
}

export default new NotificationEngine();
export { NotificationEngine };