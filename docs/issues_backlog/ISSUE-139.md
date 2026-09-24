# mobile/analytics.js: Mobile telemetry collector logs full client request headers and device hardware identifiers without PII redaction

**Domain:** Mobile & Offline Resilience  
**Complexity:** Medium  
**Labels:** `bug`, `mobile`, `privacy`, `compliance`  
**Issue ID:** ISSUE-139

---

## Background
In `backend/src/mobile/analytics.js`, client telemetry events (e.g. app open, screen view, button click, error crash logs) are ingested via `POST /api/mobile/analytics/events`:
```javascript
export async function recordTelemetry(userId, eventName, metadata, req) {
  const logEntry = {
    userId,
    eventName,
    metadata,
    headers: req.headers,
    ip: req.ip,
    timestamp: new Date(),
  };
  logger.info({ telemetry: logEntry }, 'Mobile telemetry event');
```

## Problem
- `req.headers` contains the raw `Authorization` header with active JWT bearer tokens, cookie headers, and client device IMEI/IDFA hardware identifiers.
- These full headers are written to standard CloudWatch / container logs in plaintext.
- Active bearer tokens written to logs can be viewed by anyone with CloudWatch log access, violating security policies.
- Collecting device hardware IDs without user consent violates Apple App Store Privacy guidelines and GDPR/CCPA regulations.

## Proposed Solution
1. Sanitize request data before logging: redact `authorization`, `cookie`, and sensitive headers.
2. Strip hardware identifiers (IMEI, MAC address, IDFA) from telemetry metadata unless explicitly opted-in for crash diagnostics.
3. Anonymize IP addresses: mask the last octet of IPv4 addresses (`192.168.1.xxx`) and last 80 bits of IPv6 addresses.

## Implementation Steps
1. Apply `sanitizeLogData` to telemetry objects in `mobile/analytics.js`.
2. Filter `req.headers` to an allowlist (`user-agent`, `accept-language`, `x-app-version`).
3. Anonymize IP addresses in analytics logs.
4. Add tests verifying authorization tokens and device IDs are redacted from telemetry log output.

## Acceptance Criteria
- [ ] Telemetry logs never contain authorization headers or bearer tokens.
- [ ] Device hardware identifiers and IP addresses are sanitized.
- [ ] Mobile telemetry complies with privacy regulations.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1386](https://github.com/Ethereal-Future/FuTuRe/issues/1386)
