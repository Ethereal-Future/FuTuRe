/**
 * Distributed Cache Support
 * Support for distributed caching backends
 */

import crypto from 'crypto';

export class DistributedCache {
  constructor(backend = null) {
    this.backend = backend;
    this.connected = false;
    this.cluster = [];
    this.replicationFactor = 2;
    this.failoverMap = new Map();
    this.partitionRing = [];
    this.analytics = {
      hits: 0,
      misses: 0,
      writes: 0,
      reads: 0,
      failovers: 0,
      totalLatencyMs: 0,
      operations: 0,
      nodeLoads: {},
    };
    this.encryptionKey = null;
  }

  configureCluster({ nodes = [], replicationFactor = 2, encryptionKey = null } = {}) {
    this.cluster = nodes.map(node => ({
      id: node.id,
      status: node.status || 'healthy',
      storage: node.storage || new Map(),
    }));
    this.replicationFactor = Math.max(1, Math.min(replicationFactor, this.cluster.length || 1));
    this.encryptionKey = encryptionKey;
    this._rebuildPartitionRing();
    return this;
  }

  async connect() {
    if (this.backend && typeof this.backend.connect === 'function') {
      await this.backend.connect();
      this.connected = true;
    }
  }

  async disconnect() {
    if (this.backend && typeof this.backend.disconnect === 'function') {
      await this.backend.disconnect();
      this.connected = false;
    }
  }

  async get(key) {
    const started = Date.now();
    this.analytics.reads += 1;

    if (this.cluster.length > 0) {
      const value = this._clusterGet(key);
      this._recordLatency(started);
      if (value == null) {
        this.analytics.misses += 1;
        return null;
      }
      this.analytics.hits += 1;
      return this._decodeValue(value);
    }

    if (!this.backend) return null;
    const value = await this.backend.get(key);
    this._recordLatency(started);
    if (value == null) this.analytics.misses += 1;
    else this.analytics.hits += 1;
    return value;
  }

  async set(key, value, ttl) {
    const started = Date.now();
    this.analytics.writes += 1;

    if (this.cluster.length > 0) {
      const payload = this._encodeValue(value);
      const placements = this._getReplicaNodes(key);
      const expiresAt = ttl ? Date.now() + (ttl * 1000) : null;

      for (const node of placements) {
        node.storage.set(key, { value: payload, expiresAt });
        this.analytics.nodeLoads[node.id] = (this.analytics.nodeLoads[node.id] || 0) + 1;
      }
      this._recordLatency(started);
      return { stored: placements.length };
    }

    if (!this.backend) return;
    const result = await this.backend.set(key, value, ttl);
    this._recordLatency(started);
    return result;
  }

  async delete(key) {
    if (this.cluster.length > 0) {
      for (const node of this.cluster) {
        node.storage.delete(key);
      }
      return { deleted: true };
    }

    if (!this.backend) return;
    return await this.backend.delete(key);
  }

  async clear() {
    if (this.cluster.length > 0) {
      for (const node of this.cluster) {
        node.storage.clear();
      }
      return { cleared: true };
    }

    if (!this.backend) return;
    return await this.backend.clear();
  }

  async getMultiple(keys) {
    if (!this.backend) return {};
    const result = {};
    for (const key of keys) {
      result[key] = await this.get(key);
    }
    return result;
  }

  async setMultiple(data, ttl) {
    if (!this.backend) return;
    for (const [key, value] of Object.entries(data)) {
      await this.set(key, value, ttl);
    }
  }

  isConnected() {
    return this.connected;
  }

  getPartitionForKey(key) {
    if (this.cluster.length === 0) return null;
    const hash = this._hash(key);
    for (const entry of this.partitionRing) {
      if (hash <= entry.hash) return entry.nodeId;
    }
    return this.partitionRing[0]?.nodeId || null;
  }

  markNodeStatus(nodeId, status) {
    const node = this.cluster.find(item => item.id === nodeId);
    if (!node) return false;
    node.status = status;
    if (status === 'down') {
      const fallback = this.cluster.find(item => item.id !== nodeId && item.status === 'healthy');
      if (fallback) this.failoverMap.set(nodeId, fallback.id);
    }
    return true;
  }

  async warm(keysWithValues = {}, ttl = null) {
    await this.setMultiple(keysWithValues, ttl);
    return { warmed: Object.keys(keysWithValues).length };
  }

  async preload(loader, keys = [], ttl = null) {
    const results = {};
    for (const key of keys) {
      results[key] = await loader(key);
    }
    await this.setMultiple(results, ttl);
    return { preloaded: keys.length };
  }

  getAnalytics() {
    return {
      ...this.analytics,
      hitRate: this.analytics.reads === 0 ? 0 : this.analytics.hits / this.analytics.reads,
      avgLatencyMs: this.analytics.operations === 0 ? 0 : this.analytics.totalLatencyMs / this.analytics.operations,
      nodes: this.cluster.map(node => ({
        id: node.id,
        status: node.status,
        keys: node.storage.size,
      })),
    };
  }

  optimize() {
    const nodeLoadEntries = Object.entries(this.analytics.nodeLoads);
    const sorted = nodeLoadEntries.sort((a, b) => b[1] - a[1]);
    return {
      hottestNodes: sorted.slice(0, 3).map(([nodeId, writes]) => ({ nodeId, writes })),
      recommendation: sorted.length > 0 && sorted[0][1] > (sorted[sorted.length - 1]?.[1] || 0) * 2
        ? 'rebalance_partitions'
        : 'current_distribution_ok',
    };
  }

  createBackup() {
    const snapshot = {
      createdAt: new Date().toISOString(),
      nodes: this.cluster.map(node => ({
        id: node.id,
        status: node.status,
        entries: Array.from(node.storage.entries()),
      })),
    };
    return JSON.stringify(snapshot);
  }

  restoreBackup(serializedBackup) {
    const data = JSON.parse(serializedBackup);
    this.cluster = data.nodes.map(node => ({
      id: node.id,
      status: node.status,
      storage: new Map(node.entries),
    }));
    this._rebuildPartitionRing();
    return { restored: true, nodes: this.cluster.length };
  }

  _recordLatency(started) {
    this.analytics.operations += 1;
    this.analytics.totalLatencyMs += (Date.now() - started);
  }

  _hash(input) {
    return Number.parseInt(
      crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, 8),
      16,
    );
  }

  _rebuildPartitionRing() {
    this.partitionRing = [];
    for (const node of this.cluster) {
      for (let i = 0; i < 100; i += 1) {
        this.partitionRing.push({
          hash: this._hash(`${node.id}:${i}`),
          nodeId: node.id,
        });
      }
    }
    this.partitionRing.sort((a, b) => a.hash - b.hash);
  }

  _getReplicaNodes(key) {
    if (this.cluster.length === 0) return [];
    const primaryNodeId = this.getPartitionForKey(key);
    const healthyNodes = this.cluster.filter(node => node.status === 'healthy');
    if (healthyNodes.length === 0) return [];

    const primary = healthyNodes.find(node => node.id === primaryNodeId) || healthyNodes[0];
    const replicas = [primary];
    for (const node of healthyNodes) {
      if (replicas.length >= this.replicationFactor) break;
      if (!replicas.some(item => item.id === node.id)) {
        replicas.push(node);
      }
    }
    return replicas;
  }

  _clusterGet(key) {
    const nodeId = this.getPartitionForKey(key);
    const primary = this.cluster.find(node => node.id === nodeId);
    const candidateNodes = [];

    if (primary?.status === 'healthy') candidateNodes.push(primary);
    if (primary?.status === 'down' && this.failoverMap.has(primary.id)) {
      const failover = this.cluster.find(node => node.id === this.failoverMap.get(primary.id));
      if (failover) {
        candidateNodes.push(failover);
        this.analytics.failovers += 1;
      }
    }

    for (const node of this.cluster) {
      if (candidateNodes.length >= this.replicationFactor) break;
      if (node.status === 'healthy' && !candidateNodes.some(item => item.id === node.id)) {
        candidateNodes.push(node);
      }
    }

    for (const node of candidateNodes) {
      const entry = node.storage.get(key);
      if (!entry) continue;
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        node.storage.delete(key);
        continue;
      }
      return entry.value;
    }
    return null;
  }

  _encodeValue(value) {
    const raw = JSON.stringify(value);
    if (!this.encryptionKey) return raw;

    const key = crypto.createHash('sha256').update(this.encryptionKey).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
    return `enc:${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  _decodeValue(stored) {
    if (!stored?.startsWith?.('enc:')) {
      return JSON.parse(stored);
    }
    if (!this.encryptionKey) {
      throw new Error('Encrypted payload requires encryption key');
    }

    const [, ivHex, payloadHex] = stored.split(':');
    const key = crypto.createHash('sha256').update(this.encryptionKey).digest();
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payloadHex, 'hex')),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString('utf8'));
  }
}

export const createDistributedCache = (backend) => new DistributedCache(backend);
