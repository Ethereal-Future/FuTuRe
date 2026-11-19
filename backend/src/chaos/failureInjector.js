import crypto from 'crypto';

// Endpoints that must NEVER receive failure injection, regardless of
// probability settings or canary authentication. Frozen to prevent mutation.
const PROTECTED_ENDPOINTS = Object.freeze([
  '/api/transactions/submit',
  '/api/recovery/execute'
]);

class FailureInjector {
  constructor() {
    this.injections = new Map();
    this.activeFailures = new Set();
    this.protectedEndpoints = PROTECTED_ENDPOINTS;
  }

  /**
   * Returns the immutable blocklist of protected endpoints.
   */
  getProtectedEndpoints() {
    return this.protectedEndpoints;
  }

  /**
   * Normalizes a request path, stripping query strings and trailing slashes.
   */
  normalizePath(path) {
    if (typeof path !== 'string') return '';
    const withoutQuery = path.split('?')[0];
    if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) {
      return withoutQuery.slice(0, -1);
    }
    return withoutQuery;
  }

  /**
   * Returns true if the given request path is a protected endpoint that can
   * never receive failure injection.
   */
  isProtectedEndpoint(reqOrPath) {
    const rawPath = typeof reqOrPath === 'string'
      ? reqOrPath
      : (reqOrPath && (reqOrPath.path || reqOrPath.originalUrl || reqOrPath.url));
    const path = this.normalizePath(rawPath);
    return this.protectedEndpoints.some(
      (protectedPath) => path === protectedPath || path.startsWith(`${protectedPath}/`)
    );
  }

  /**
   * Resolves the configured canary signing secret.
   */
  getCanarySecret() {
    return process.env.CHAOS_CANARY_SECRET || '';
  }

  /**
   * Verifies a signed canary token of the form `<payload>.<hmacHex>` where the
   * HMAC is computed over the payload using the configured canary secret.
   * Returns the decoded payload object on success, or null on failure.
   */
  verifyCanaryToken(token) {
    if (typeof token !== 'string' || token.length === 0) return null;

    const secret = this.getCanarySecret();
    if (!secret) return null;

    const separatorIndex = token.lastIndexOf('.');
    if (separatorIndex <= 0 || separatorIndex === token.length - 1) return null;

    const payload = token.slice(0, separatorIndex);
    const providedSignature = token.slice(separatorIndex + 1);

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    const providedBuffer = Buffer.from(providedSignature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (providedBuffer.length !== expectedBuffer.length) return null;
    if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) return null;

    try {
      const decoded = JSON.parse(
        Buffer.from(payload, 'base64').toString('utf8')
      );
      if (!decoded || typeof decoded !== 'object') return null;
      return decoded;
    } catch (err) {
      return null;
    }
  }

  /**
   * Extracts canary authentication material from a request.
   */
  extractCanaryHeaders(req) {
    if (!req || typeof req !== 'object') return { experimentId: null, token: null };
    const headers = req.headers || {};
    const experimentId = headers['x-chaos-experiment-id'] || null;
    const token = headers['x-canary-token'] || headers['x-chaos-canary-token'] || null;
    return { experimentId, token };
  }

  /**
   * Returns true only when the request carries a valid, signed canary token
   * AND a matching X-Chaos-Experiment-ID header. Any failure here means the
   * request is treated as real traffic and is never disrupted.
   */
  hasValidCanaryAuth(req) {
    const { experimentId, token } = this.extractCanaryHeaders(req);
    if (!experimentId || !token) return false;

    const payload = this.verifyCanaryToken(token);
    if (!payload) return false;

    if (payload.experimentId !== experimentId) return false;

    if (payload.expiresAt && Date.now() > payload.expiresAt) return false;

    return true;
  }

  injectLatency(targetId, delayMs, probability = 1.0) {
    const injection = {
      type: 'LATENCY',
      targetId,
      delayMs,
      probability,
      startTime: Date.now(),
      enabled: true
    };

    this.injections.set(`latency-${targetId}`, injection);
    this.activeFailures.add(`latency-${targetId}`);
    return injection;
  }

  injectError(targetId, errorRate, errorCode = 500, probability = 1.0) {
    const injection = {
      type: 'ERROR',
      targetId,
      errorRate,
      errorCode,
      probability,
      startTime: Date.now(),
      enabled: true,
      errorCount: 0
    };

    this.injections.set(`error-${targetId}`, injection);
    this.activeFailures.add(`error-${targetId}`);
    return injection;
  }

  injectPacketLoss(targetId, lossRate, probability = 1.0) {
    const injection = {
      type: 'PACKET_LOSS',
      targetId,
      lossRate,
      probability,
      startTime: Date.now(),
      enabled: true,
      droppedPackets: 0
    };

    this.injections.set(`packet-loss-${targetId}`, injection);
    this.activeFailures.add(`packet-loss-${targetId}`);
    return injection;
  }

  injectCpuSpike(targetId, cpuUsage, durationMs) {
    const injection = {
      type: 'CPU_SPIKE',
      targetId,
      cpuUsage,
      durationMs,
      startTime: Date.now(),
      enabled: true
    };

    this.injections.set(`cpu-spike-${targetId}`, injection);
    this.activeFailures.add(`cpu-spike-${targetId}`);

    setTimeout(() => {
      this.removeInjection(`cpu-spike-${targetId}`);
    }, durationMs);

    return injection;
  }

  injectMemoryLeak(targetId, leakRateMb) {
    const injection = {
      type: 'MEMORY_LEAK',
      targetId,
      leakRateMb,
      startTime: Date.now(),
      enabled: true,
      totalLeaked: 0
    };

    this.injections.set(`memory-leak-${targetId}`, injection);
    this.activeFailures.add(`memory-leak-${targetId}`);
    return injection;
  }

  shouldInject(injectionId) {
    const injection = this.injections.get(injectionId);
    if (!injection || !injection.enabled) return false;
    return Math.random() < injection.probability;
  }

  /**
   * Request-aware injection gate. Failure injection is strictly opt-in:
   *  - Protected endpoints are rejected unconditionally.
   *  - Requests without valid signed canary authentication are bypassed
   *    entirely, regardless of probability settings.
   */
  shouldInjectForRequest(req, injectionId) {
    if (this.isProtectedEndpoint(req)) return false;
    if (!this.hasValidCanaryAuth(req)) return false;
    return this.shouldInject(injectionId);
  }

  getInjection(injectionId) {
    return this.injections.get(injectionId);
  }

  removeInjection(injectionId) {
    this.injections.delete(injectionId);
    this.activeFailures.delete(injectionId);
  }

  removeAllInjections() {
    this.injections.clear();
    this.activeFailures.clear();
  }

  getActiveFailures() {
    return Array.from(this.activeFailures).map(id => this.injections.get(id));
  }

  disableInjection(injectionId) {
    const injection = this.injections.get(injectionId);
    if (injection) {
      injection.enabled = false;
    }
  }

  enableInjection(injectionId) {
    const injection = this.injections.get(injectionId);
    if (injection) {
      injection.enabled = true;
    }
  }
}

export default new FailureInjector();
