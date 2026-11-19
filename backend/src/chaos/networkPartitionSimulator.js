const CHAOS_CONTEXT_HEADER = 'x-chaos-context';

class NetworkPartitionSimulator {
  constructor() {
    this.partitions = new Map();
    this.activePartitions = new Set();
    // Scoped interceptors registered via install(). Each entry is a
    // { client, original, interceptor } record so uninstall() can fully
    // restore the wrapped client without touching global networking modules.
    this.interceptors = [];
    this.installed = false;
  }

  createPartition(partitionId, affectedServices, healTime = null, options = {}) {
    const partition = {
      id: partitionId,
      affectedServices,
      startTime: Date.now(),
      healTime,
      enabled: true,
      requestsBlocked: 0,
      requestsAttempted: 0,
      // Scoped targeting: only requests matching these targets (or carrying a
      // matching X-Chaos-Context header) are affected by this partition.
      targetHosts: options.targetHosts || [],
      targetPorts: options.targetPorts || [],
      contextId: options.contextId || partitionId
    };

    this.partitions.set(partitionId, partition);
    this.activePartitions.add(partitionId);

    if (healTime) {
      setTimeout(() => {
        this.healPartition(partitionId);
      }, healTime);
    }

    return partition;
  }

  _normalizeHost(host) {
    if (!host) return '';
    return String(host).toLowerCase().replace(/^\[|\]$/g, '');
  }

  _matchesTarget(partition, host, port) {
    const normalizedHost = this._normalizeHost(host);
    const hasHostRules = partition.targetHosts.length > 0;
    const hasPortRules = partition.targetPorts.length > 0;

    if (!hasHostRules && !hasPortRules) {
      // No explicit target configured: only context-header matching applies.
      return false;
    }

    const hostMatches = !hasHostRules ||
      partition.targetHosts.some(h => this._normalizeHost(h) === normalizedHost);
    const portMatches = !hasPortRules ||
      partition.targetPorts.some(p => Number(p) === Number(port));

    return hostMatches && portMatches;
  }

  _getContextHeader(headers) {
    if (!headers) return null;
    if (typeof headers.get === 'function') {
      return headers.get(CHAOS_CONTEXT_HEADER) || headers.get('X-Chaos-Context') || null;
    }
    const key = Object.keys(headers).find(
      k => k.toLowerCase() === CHAOS_CONTEXT_HEADER
    );
    return key ? headers[key] : null;
  }

  /**
   * Determine whether a specific outbound request should be partitioned.
   * A request is only affected when it either targets a configured host/port
   * or carries an X-Chaos-Context header matching an active partition.
   * Returns the matching partition or null.
   */
  matchPartition({ host, port, headers } = {}) {
    const contextId = this._getContextHeader(headers);

    for (const partitionId of this.activePartitions) {
      const partition = this.partitions.get(partitionId);
      if (!partition || !partition.enabled) continue;

      if (contextId && contextId === partition.contextId) {
        return partition;
      }

      if (this._matchesTarget(partition, host, port)) {
        return partition;
      }
    }

    return null;
  }

  /**
   * Evaluate a request against active partitions and update bookkeeping.
   * Returns true when the request should be blocked.
   */
  shouldBlockRequest(request = {}) {
    const partition = this.matchPartition(request);
    if (partition) {
      this.blockRequest(partition.id);
      return true;
    }
    return false;
  }

  /**
   * Wrap a scoped HTTP client (e.g. an axios instance or a fetch-like
   * function) with partition interception. The native http/https/fetch
   * modules are never modified.
   *
   * Supported clients:
   *  - Axios-like instances exposing `interceptors.request.use`
   *  - fetch-like functions `(url, options) => Promise`
   */
  install(client) {
    if (!client) {
      throw new Error('NetworkPartitionSimulator.install requires a scoped client');
    }

    if (client.interceptors && client.interceptors.request && typeof client.interceptors.request.use === 'function') {
      const interceptorId = client.interceptors.request.use(config => {
        const url = this._parseUrl(config && config.url, config && config.baseURL);
        const headers = (config && config.headers) || {};
        const blocked = this.shouldBlockRequest({
          host: url.host,
          port: url.port,
          headers
        });
        if (blocked) {
          const error = new Error('Network partition: request blocked by chaos simulator');
          error.code = 'ECHAOSPARTITION';
          error.isChaosPartition = true;
          throw error;
        }
        return config;
      });

      const record = {
        client,
        type: 'axios',
        interceptorId,
        eject: () => client.interceptors.request.eject(interceptorId)
      };
      this.interceptors.push(record);
      this.installed = true;
      return record;
    }

    if (typeof client === 'function') {
      const original = client;
      const simulator = this;
      const wrapped = function (url, options = {}) {
        const parsed = simulator._parseUrl(
          typeof url === 'string' ? url : (url && url.url),
          options && options.baseURL
        );
        const headers = (options && options.headers) || (url && url.headers) || {};
        const blocked = simulator.shouldBlockRequest({
          host: parsed.host,
          port: parsed.port,
          headers
        });
        if (blocked) {
          const error = new Error('Network partition: request blocked by chaos simulator');
          error.code = 'ECHAOSPARTITION';
          error.isChaosPartition = true;
          return Promise.reject(error);
        }
        return original.apply(this, arguments);
      };

      const record = {
        client,
        type: 'fetch',
        original,
        wrapped,
        eject: () => {
          // Restore the original function reference on the owning object if
          // possible; otherwise the caller is responsible for using `wrapped`.
          if (client.__owner && client.__owner[client.__key] === wrapped) {
            client.__owner[client.__key] = original;
          }
        }
      };
      this.interceptors.push(record);
      this.installed = true;
      return record;
    }

    throw new Error('Unsupported client for NetworkPartitionSimulator.install');
  }

  /**
   * Remove every registered interceptor and restore native behavior.
   * Safe to call multiple times.
   */
  uninstall() {
    for (const record of this.interceptors) {
      try {
        if (typeof record.eject === 'function') {
          record.eject();
        }
      } catch (err) {
        // Teardown must never throw; swallow individual eject failures.
      }
    }
    this.interceptors = [];
    this.installed = false;
  }

  // Alias for callers that prefer explicit restore semantics.
  restore() {
    this.uninstall();
  }

  _parseUrl(url, baseURL) {
    if (!url) return { host: '', port: undefined };
    try {
      const resolved = baseURL ? new URL(url, baseURL) : new URL(url);
      const port = resolved.port
        ? Number(resolved.port)
        : (resolved.protocol === 'https:' ? 443 : 80);
      return { host: resolved.hostname, port };
    } catch (err) {
      // Relative or non-URL strings: fall back to a best-effort host parse.
      const match = String(url).match(/^(?:https?:)?\/\/([^/:]+)(?::(\d+))?/i);
      if (match) {
        return {
          host: match[1],
          port: match[2] ? Number(match[2]) : undefined
        };
      }
      return { host: '', port: undefined };
    }
  }

  isPartitioned(service1, service2) {
    for (const partition of this.activePartitions) {
      const p = this.partitions.get(partition);
      if (p && p.enabled) {
        const services = p.affectedServices;
        if ((services.includes(service1) && services.includes(service2)) ||
            (services.includes(service1) && services.includes('*')) ||
            (services.includes(service2) && services.includes('*'))) {
          return true;
        }
      }
    }
    return false;
  }

  blockRequest(partitionId) {
    const partition = this.partitions.get(partitionId);
    if (partition) {
      partition.requestsBlocked++;
      partition.requestsAttempted++;
    }
  }

  allowRequest(partitionId) {
    const partition = this.partitions.get(partitionId);
    if (partition) {
      partition.requestsAttempted++;
    }
  }

  healPartition(partitionId) {
    const partition = this.partitions.get(partitionId);
    if (partition) {
      partition.enabled = false;
      this.activePartitions.delete(partitionId);
    }
  }

  getPartitionStats(partitionId) {
    const partition = this.partitions.get(partitionId);
    if (!partition) return null;

    return {
      id: partitionId,
      duration: Date.now() - partition.startTime,
      requestsBlocked: partition.requestsBlocked,
      requestsAttempted: partition.requestsAttempted,
      blockRate: partition.requestsAttempted > 0 
        ? (partition.requestsBlocked / partition.requestsAttempted) * 100 
        : 0
    };
  }

  getActivePartitions() {
    return Array.from(this.activePartitions).map(id => this.partitions.get(id));
  }

  removePartition(partitionId) {
    this.partitions.delete(partitionId);
    this.activePartitions.delete(partitionId);
  }
}

export default new NetworkPartitionSimulator();
