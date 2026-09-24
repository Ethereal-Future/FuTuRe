# infra/alb.tf: Application Load Balancer 60-second idle timeout drops long-polling Stellar Horizon payment streams

**Domain:** Infra & Networking  
**Complexity:** Medium  
**Labels:** `bug`, `infra`, `network`, `stellar`  
**Issue ID:** ISSUE-195

---

## Background
In `infra/alb.tf`:
The AWS Application Load Balancer (ALB) is configured with default idle timeout:
`idle_timeout = 60`.

## Problem
- The backend SSE and WebSocket proxies stream real-time Stellar payment events directly to clients from Horizon (`/events`, `/payments/stream`).
- On low-volume or quiet accounts, no transactions occur for 60-180 seconds.
- The AWS ALB forcefully terminates the TCP connection with HTTP 504 Gateway Timeout or TCP RST after exactly 60 seconds of silence.
- Clients disconnect and reconnect every 60 seconds in an infinite loop, creating massive reconnection churn and missed real-time transaction alerts.

## Proposed Solution
1. Increase ALB `idle_timeout` to `300` seconds (5 minutes) in `infra/alb.tf`:
```hcl
  idle_timeout = 300
```
2. Implement backend TCP keepalive and SSE heartbeat comments (e.g. `:keepalive\n\n` every 15 seconds) so idle connections maintain active byte flow through the ALB.
3. Configure frontend clients to gracefully handle stream timeouts with jittered reconnect.

## Implementation Steps
1. Update `idle_timeout = 300` on `aws_lb.main` in `infra/alb.tf`.
2. Add 15-second SSE keep-alive heartbeat in backend streaming controller.
3. Verify stream connections stay persistently open beyond 10 minutes without dropping.

## Acceptance Criteria
- [ ] ALB idle timeout accommodates long-lived streaming connections.
- [ ] Heartbeat comments prevent intermediate proxies from prematurely terminating idle streams.
- [ ] Real-time payment streaming functions smoothly without 60s disconnection loops.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Critical for dependable real-time payment notifications.

**GitHub Issue:** [1442](https://github.com/Ethereal-Future/FuTuRe/issues/1442)
