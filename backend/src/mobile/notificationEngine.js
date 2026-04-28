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
  constructor() {
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
      id: `delivery_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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