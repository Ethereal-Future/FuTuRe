import { beforeEach, describe, expect, it } from 'vitest';
import { NotificationEngine } from '../src/mobile/notificationEngine.js';

describe('NotificationEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new NotificationEngine();
    engine.registerTemplate('promo', {
      title: 'Hi {{user.firstName}}',
      body: 'Your offer is {{offer}} (variant {{variant}}).',
    });
    engine.registerUserProfile('u1', {
      preferredChannels: ['email', 'push'],
      timezoneOffsetMinutes: 0,
      engagementByHour: { 8: 0.3, 14: 0.8, 20: 0.1 },
      attributes: { firstName: 'Sam' },
    });
    engine.setCompliance('u1', {
      marketingOptIn: true,
      unsubscribed: false,
      quietHours: { start: 23, end: 6 },
      allowedRegions: ['US', 'CA'],
    });
  });

  it('routes notifications based on preferences and urgency', () => {
    expect(engine.routeNotification('u1', { urgency: 'normal' }, ['push', 'email'])).toBe('email');
    expect(engine.routeNotification('u1', { urgency: 'critical' }, ['push', 'email'])).toBe('push');
  });

  it('renders personalized templates', () => {
    const rendered = engine.personalize('promo', 'u1', { offer: '20% OFF', variant: 'A' });
    expect(rendered.title).toBe('Hi Sam');
    expect(rendered.body).toContain('20% OFF');
  });

  it('assigns deterministic A/B test variants', () => {
    const variants = [{ id: 'A', weight: 1 }, { id: 'B', weight: 1 }];
    const first = engine.chooseVariant('exp-1', 'u1', variants);
    const second = engine.chooseVariant('exp-1', 'u1', variants);
    expect(first.id).toBe(second.id);
  });

  it('optimizes delivery using engagement profile', () => {
    const optimized = engine.optimizeDelivery('u1', {});
    const hour = new Date(optimized.sendAt).getUTCHours();
    expect(hour).toBe(14);
  });

  it('enforces compliance policies', () => {
    const allowed = engine.checkCompliance('u1', { type: 'marketing', urgency: 'normal', region: 'US' }, new Date('2026-03-28T14:00:00.000Z'));
    expect(allowed.allowed).toBe(true);

    const blocked = engine.checkCompliance('u1', { type: 'marketing', urgency: 'normal', region: 'FR' }, new Date('2026-03-28T14:00:00.000Z'));
    expect(blocked.allowed).toBe(false);
  });

  it('tracks analytics and performance from delivery lifecycle', async () => {
    const response = await engine.send('u1', {
      templateId: 'promo',
      type: 'marketing',
      urgency: 'normal',
      region: 'US',
      channels: ['push', 'email'],
      data: { offer: '30% OFF' },
      experiment: {
        id: 'exp-2',
        variants: [{ id: 'A', weight: 1 }, { id: 'B', weight: 1 }],
      },
    });

    expect(response.delivered).toBe(true);
    engine.trackInteraction(response.delivery.id, 'open');
    engine.trackInteraction(response.delivery.id, 'click');

    const analytics = engine.getAnalytics();
    expect(analytics.deliveries).toBe(1);
    expect(analytics.opens).toBe(1);
    expect(analytics.clicks).toBe(1);

    const perf = engine.getPerformanceMetrics();
    expect(perf.sends).toBe(1);
    expect(perf.avgLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('deduplicates rapid repeated notifications', async () => {
    const payload = {
      templateId: 'promo',
      type: 'marketing',
      urgency: 'normal',
      region: 'US',
      data: { offer: '40% OFF' },
      delivery: { dedupeWindowMs: 60000 },
      dedupeKey: 'campaign-1',
    };

    const first = await engine.send('u1', payload);
    const second = await engine.send('u1', payload);
    expect(first.delivered).toBe(true);
    expect(second.delivered).toBe(false);
    expect(second.reason).toBe('deduplicated');
  });
});