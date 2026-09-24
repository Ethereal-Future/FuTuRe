# db/client.js: connectDB terminates the entire Node.js runtime with process.exit(1) on transient connection retry exhaustion

**Domain:** Database & Persistence  
**Complexity:** Medium  
**Labels:** `bug`, `database`, `resilience`, `backend`  
**Issue ID:** ISSUE-058

---

## Background
In `backend/src/db/client.js`, `connectDB` retries connecting to PostgreSQL up to 5 times (lines 98-127):
```javascript
export async function connectDB() {
  const maxAttempts = 5;
  const initialDelayMs = 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await baseClient.$connect();
      logger.info('db.connected');
      return;
    } catch (err) {
      if (attempt === maxAttempts) {
        logger.error('db.connection.failed', { ... });
        process.exit(1);
      }
...
```

## Problem
- `initialDelayMs = 1000` with 5 attempts results in delays: 1s, 2s, 4s, 8s = 15 seconds total window.
- During AWS RDS Multi-AZ failovers, minor version upgrades, or container orchestrator cold boots, PostgreSQL can take 30 to 60 seconds to become available.
- Calling `process.exit(1)` kills the container abruptly. In Docker Compose or ECS, rapid consecutive container exits trigger crash-loop backoff, causing the orchestrator to mark the deployment as permanently failed.
- Calling `process.exit(1)` inside a library module makes unit and integration testing impossible without process hijacking.

## Proposed Solution
1. Throw an explicit `DatabaseConnectionError` rather than calling `process.exit(1)`.
2. Let `server.js` handle startup lifecycle errors gracefully.
3. Increase max attempts to 10 and cap exponential backoff delay at 10s (allowing up to ~90 seconds of database recovery time during failovers).
4. Allow the HTTP healthcheck endpoint `/health` to report `status: degraded` while database reconnection attempts continue in the background.

## Implementation Steps
1. Remove `process.exit(1)` from `connectDB` in `backend/src/db/client.js`.
2. Throw `new Error('Failed to connect to database after ' + maxAttempts + ' attempts')`.
3. Update `server.js` to catch connection failure and manage shutdown or graceful degradation.
4. Configure backoff parameters: 10 attempts, max delay 10s.
5. Add tests verifying error handling without process termination.

## Acceptance Criteria
- [ ] `connectDB` does not invoke `process.exit(1)`.
- [ ] Transient database restarts up to 60 seconds recover without killing container instances.
- [ ] Unit tests can test database connection failure scenarios safely.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1305](https://github.com/Ethereal-Future/FuTuRe/issues/1305)
