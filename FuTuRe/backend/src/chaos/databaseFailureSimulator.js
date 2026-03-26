class DatabaseFailureSimulator {
  constructor() {
    this.databaseFailures = new Map();
    this.queryFailures = new Map();
  }

  failDatabase(databaseId, failureType = 'CONNECTION_TIMEOUT', recoveryTime = null) {
    const failure = {
      databaseId,
      failureType,
      startTime: Date.now(),
      recoveryTime,
      enabled: true,
      queriesAttempted: 0,
      queriesFailed: 0,
      downtime: 0
    };

    this.databaseFailures.set(databaseId, failure);

    if (recoveryTime) {
      setTimeout(() => {
        this.recoverDatabase(databaseId);
      }, recoveryTime);
    }

    return failure;
  }

  injectQueryFailure(queryPattern, failureRate, errorMessage = 'Query failed') {
    const failure = {
      queryPattern,
      failureRate,
      errorMessage,
      startTime: Date.now(),
      enabled: true,
      queriesMatched: 0,
      queriesFailed: 0
    };

    this.queryFailures.set(queryPattern, failure);
    return failure;
  }

  isDatabaseFailed(databaseId) {
    const failure = this.databaseFailures.get(databaseId);
    return failure && failure.enabled;
  }

  shouldFailQuery(query) {
    for (const [pattern, failure] of this.queryFailures) {
      if (failure.enabled && query.includes(pattern)) {
        failure.queriesMatched++;
        if (Math.random() < failure.failureRate) {
          failure.queriesFailed++;
          return { failed: true, error: failure.errorMessage };
        }
      }
    }
    return { failed: false };
  }

  recordQueryAttempt(databaseId) {
    const failure = this.databaseFailures.get(databaseId);
    if (failure) {
      failure.queriesAttempted++;
    }
  }

  recordQueryFailure(databaseId) {
    const failure = this.databaseFailures.get(databaseId);
    if (failure) {
      failure.queriesFailed++;
    }
  }

  recoverDatabase(databaseId) {
    const failure = this.databaseFailures.get(databaseId);
    if (failure) {
      failure.enabled = false;
      failure.downtime = Date.now() - failure.startTime;
    }
  }

  getFailureStats(databaseId) {
    const failure = this.databaseFailures.get(databaseId);
    if (!failure) return null;

    return {
      databaseId,
      failureType: failure.failureType,
      duration: failure.enabled ? Date.now() - failure.startTime : failure.downtime,
      queriesAttempted: failure.queriesAttempted,
      queriesFailed: failure.queriesFailed,
      failureRate: failure.queriesAttempted > 0 
        ? (failure.queriesFailed / failure.queriesAttempted) * 100 
        : 0,
      status: failure.enabled ? 'FAILED' : 'RECOVERED'
    };
  }

  removeFailure(databaseId) {
    this.databaseFailures.delete(databaseId);
  }

  removeQueryFailure(queryPattern) {
    this.queryFailures.delete(queryPattern);
  }
}

export default new DatabaseFailureSimulator();
