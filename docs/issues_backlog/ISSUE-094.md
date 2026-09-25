# webhooks/dispatcher.js: Time-of-Check to Time-of-Use (TOCTOU) DNS rebinding SSRF vulnerability in webhook delivery fetch

**Domain:** Webhooks & Delivery  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `webhooks`, `critical-bug`  
**Issue ID:** ISSUE-094

---

## Background
In `backend/src/webhooks/dispatcher.js`, `deliverOnce` validates the webhook URL before dispatching the payload (lines 9-28):
```javascript
async function deliverOnce(webhook, payload) {
  // Re-check the URL at delivery time in case the resolved address changed
  const validation = await validateWebhookUrl(webhook.url);
  if (!validation.valid) {
    throw new Error(`Webhook URL failed validation: ${validation.error}`);
  }

  const signature = signPayload(webhook.signingSecret, payload);

  const res = await fetch(webhook.url, {
    method: 'POST',
    ...
```
`validateWebhookUrl` uses `dns.promises.lookup(hostname)` to verify that the target domain does not resolve to a private IP (127.0.0.1, 169.254.169.254, etc.).

## Problem
- `validateWebhookUrl` performs DNS resolution on the hostname and verifies the IP is public.
- Next, `fetch(webhook.url)` performs a SECOND independent DNS lookup using the Node.js runtime HTTP agent!
- **DNS Rebinding Attack (TOCTOU)**:
  1. An attacker registers a webhook with domain `attacker.com` pointing to a DNS server with TTL=0.
  2. First lookup (`validateWebhookUrl`): DNS server returns a benign public IP (e.g. 1.1.1.1). Validation passes!
  3. Second lookup (`fetch`): DNS server returns `169.254.169.254` (AWS metadata service) or `10.0.0.5` (internal database).
  4. Node `fetch` sends the HTTP POST request to the internal AWS metadata service or private infrastructure!
- The pre-flight URL check provides zero protection against DNS rebinding.

## Proposed Solution
Pin the resolved IP address:
1. When `validateWebhookUrl` resolves the public IP address, capture that exact IP address.
2. In the HTTP agent or custom dispatcher, connect directly to the pinned IP address (e.g. using `undici` or `agent.createConnection`) while passing the original hostname in the HTTP `Host` header and TLS SNI extension.
3. This guarantees that `fetch` connects to the exact validated IP address and prevents any secondary DNS resolution.

## Implementation Steps
1. Refactor `webhooks/urlValidator.js` to return the validated resolved IP address.
2. Configure an `undici` / `http.Agent` dispatcher in `dispatcher.js` that connects to the pinned IP.
3. Pass the original hostname in TLS `servername` (SNI) and HTTP `Host` header.
4. Add security tests simulating DNS rebinding with changing IP addresses and assert connection refusal.

## Acceptance Criteria
- [ ] HTTP request connects strictly to the pre-validated IP address.
- [ ] DNS rebinding to private IPs (127.0.0.1, 169.254.169.254) is completely blocked.
- [ ] TLS SNI and Host headers match the original domain.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1341](https://github.com/Ethereal-Future/FuTuRe/issues/1341)
