# frontend/hooks/useWebSocket.js: Zombie connection state on device sleep/wake due to missing heartbeat ping/pong

**Domain:** Frontend & WebSockets  
**Complexity:** Medium  
**Labels:** `bug`, `frontend`, `websocket`, `mobile`  
**Issue ID:** ISSUE-184

---

## Background
In `frontend/src/hooks/useWebSocket.js`:
The hook manages a persistent WebSocket connection to the backend notification and payment stream gateway.

## Problem
- When a mobile device locks its screen or a laptop sleeps, TCP connections are quietly dropped by the OS or intermediary NAT routers without sending a TCP FIN/RST packet.
- Upon waking, the browser's `WebSocket.readyState` remains `1` (OPEN) because no socket event has fired.
- The application believes it is connected and stops receiving real-time payment alerts and balance updates indefinitely.
- Reconnection logic never triggers because `onclose` is never called.

## Proposed Solution
1. Implement an application-level ping/pong heartbeat (every 30 seconds).
2. If no pong response is received within 10 seconds of ping, force-close the socket (`ws.close()`) and initiate exponential backoff reconnection.
3. Listen to browser `visibilitychange` and `online` window events to trigger an immediate health check and reconnect upon wake.

## Implementation Steps
1. Add heartbeat ping/pong timer to `frontend/src/hooks/useWebSocket.js`.
2. Add `document.addEventListener('visibilitychange', ...)` handler.
3. Add unit test verifying reconnect trigger when pong is missed.

## Acceptance Criteria
- [ ] Silent dropped connections are detected within 40 seconds via missed heartbeat.
- [ ] Waking device from sleep triggers immediate connection verification and reconnect.
- [ ] Real-time notifications resume seamlessly after network disruptions.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Essential for reliable mobile push notifications.

**GitHub Issue:** [1431](https://github.com/Ethereal-Future/FuTuRe/issues/1431)
