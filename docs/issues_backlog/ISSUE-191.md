# docker-compose.yml: Redis service lacks volume persistence causing session and rate-limit loss on restart

**Domain:** DevOps & Local Parity  
**Complexity:** Medium  
**Labels:** `bug`, `docker`, `devops`  
**Issue ID:** ISSUE-191

---

## Background
In `docker-compose.yml` (lines 48-61):
```yaml
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD-SHELL", "redis-cli ping"]
      interval: 5s
      timeout: 5s
      retries: 5
```
The Redis service has no volume definition attached.

## Problem
- Unlike PostgreSQL which defines `volumes: - db_data:/var/lib/postgresql/data`, Redis stores all state purely in volatile container memory.
- Whenever a developer runs `docker-compose down` or restarts the stack:
  1. All active session tokens, cached account balances, and rate limit counters are wiped out.
  2. Developers are constantly forced to re-login, re-seed test sessions, and re-create mock WebAuthn challenges.
  3. Tests expecting cached state across container restarts fail intermittently.

## Proposed Solution
1. Define a named volume `redis_data` in `docker-compose.yml`.
2. Mount the volume to `/data` in the Redis service container.
3. Enable append-only file persistence with command `redis-server --appendonly yes`.

## Implementation Steps
1. Add `redis_data:` to top-level `volumes` in `docker-compose.yml`.
2. Add `volumes: - redis_data:/data` and `--appendonly yes` to the Redis service.
3. Verify data persistence across `docker compose restart redis`.

## Acceptance Criteria
- [ ] Redis persists data across container restarts.
- [ ] Developer login sessions survive local compose restarts.
- [ ] AOF persistence is enabled.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Improves local developer productivity and test repeatability.

**GitHub Issue:** [1438](https://github.com/Ethereal-Future/FuTuRe/issues/1438)
