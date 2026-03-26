class NetworkPartitionSimulator {
  constructor() {
    this.partitions = new Map();
    this.activePartitions = new Set();
  }

  createPartition(partitionId, affectedServices, healTime = null) {
    const partition = {
      id: partitionId,
      affectedServices,
      startTime: Date.now(),
      healTime,
      enabled: true,
      requestsBlocked: 0,
      requestsAttempted: 0
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
