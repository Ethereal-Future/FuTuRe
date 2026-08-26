# Runbook: Horizon Outage

## Overview

The backend talks to the Stellar network exclusively through a Horizon
server (`HORIZON_URL`, default `https://horizon-testnet.stellar.org` on
testnet). If that Horizon instance becomes unreachable or starts returning
persistent 5xx responses, every Stellar-dependent feature degrades: balance
lookups, payments, trustline management, path payments, multi-sig, and the
prediction-market contract calls that go through
`POST /api/v1/stellar/contract/invoke`.

The backend has two built-in defenses against this:

- **Retry with backoff** (`withHorizonRetry` in `backend/src/services/stellar.js`)
  retries transient Horizon failures automatically before the caller ever
  sees an error.
- **Circuit breaker** (`backend/src/services/circuitBreaker.js`) opens after
  `CIRCUIT_FAILURE_THRESHOLD` consecutive failures (default 5) within
  `CIRCUIT_WINDOW_MS` (default 30s), so once Horizon is confirmed down the
  backend fails fast with `503` instead of piling up slow, doomed requests.
  It self-probes every `CIRCUIT_PROBE_INTERVAL_MS` (default 30s) and closes
  again once a probe succeeds.

This runbook is for when Horizon itself — not just the backend's connection
to it — is degraded or down.

## Indicators

- `GET /health` or `GET /health/ready` reports `stellar` as `unhealthy`, with
  `checks[].circuit.state` of `OPEN` or `HALF_OPEN`
  (`backend/src/routes/health.js`).
- API responses with `503 { "error": "Service temporarily unavailable" }`
  from payment/account endpoints — this is the `error.circuitOpen` branch in
  `backend/src/routes/stellar/payments.js` and `accounts.js`.
- Logs containing `stellar.mergeAccount.failed`, `stellar.updateTrustlineLimit.failed`,
  or similar `*.failed` entries with Horizon connection errors
  (`ECONNREFUSED`, `ETIMEDOUT`, HTTP 5xx) in `backend/src/services/stellar.js`.
- A sustained increase in `getLastHorizonLatency()` / the `stellar.latencyPing.failed`
  log line — the background latency monitor started by
  `startHorizonLatencyMonitor()` pings Horizon's root endpoint every 30s.
- Users reporting payments/balances not loading in the app.

## Immediate mitigation

1. **Confirm it's Horizon, not us.** Check Horizon's own status directly:
   ```bash
   curl -sS -w '\nHTTP %{http_code}\n' "$HORIZON_URL"
   ```
   If this also fails/times out, the outage is upstream (see step 2). If it
   succeeds but the app still reports `unhealthy`, the problem is in the
   backend's network path or config (see [Root cause investigation](#root-cause-investigation)).

2. **If it's the public Horizon fleet**, check the
   [Stellar status page](https://status.stellar.org) and the `#dev-discussion`
   channel on the [Stellar Developers Discord](https://discord.gg/stellardev)
   for a known incident. There is nothing to fix on our side in this case —
   proceed to step 3 to reduce user-facing impact while it clears.

3. **Fail over to a backup Horizon URL**, if your team has provisioned a
   secondary provider (e.g. a paid Horizon provider or a self-hosted
   instance). Update `HORIZON_URL` in the backend environment and restart:
   ```bash
   # backend/.env (or your secrets manager)
   HORIZON_URL=https://your-backup-horizon.example.com

   # Restart to pick up the new value (see docs/runbook.md §1)
   kill $(lsof -ti tcp:3001) && cd backend && node src/server.js &
   ```
   Verify:
   ```bash
   curl -f http://localhost:3001/health/ready
   ```

4. **Let the circuit breaker do its job.** If you can't fail over, do not
   disable or bypass the circuit breaker — it is protecting the backend from
   cascading slow-request pileups. It will automatically probe and recover
   once Horizon (or your new `HORIZON_URL`) is healthy again. You can watch
   its state directly:
   ```bash
   curl -s http://localhost:3001/health | jq '.checks[] | select(.name=="stellar")'
   ```

5. **Communicate.** Post a status update in `#incidents` (or your team's
   equivalent) noting user-facing impact (e.g. "payments and balance refresh
   are delayed; retries are automatic") so support can set expectations.

## Root cause investigation

- **Upstream outage** — Horizon's own status page/Discord confirms it; no
  further backend-side investigation needed. Track the incident until it
  clears and note the duration for the post-mortem.
- **Rate limiting** — if `curl "$HORIZON_URL"` succeeds but application
  traffic still fails, check for HTTP 429s in the logs. The public Horizon
  fleet rate-limits by IP; consider a paid Horizon provider if this recurs.
- **Network/DNS issue between the backend and Horizon** — test connectivity
  from the same host/container the backend runs on, not just your laptop:
  ```bash
  # From the backend host
  curl -v "$HORIZON_URL" 2>&1 | head -30
  nslookup "$(node -e "console.log(new URL(process.env.HORIZON_URL).hostname)")"
  ```
- **TLS/certificate issue** — check for `CERT_HAS_EXPIRED` or similar in the
  connection error; this can affect a self-hosted Horizon instance whose
  certificate lapsed.
- **Config drift** — confirm `HORIZON_URL` actually points where you think it
  does in the running process, not just in the repo's `.env.example`:
  ```bash
  curl -s http://localhost:3001/health | jq '.checks[] | select(.name=="stellar") | .horizonUrl'
  ```

## Resolution

1. Once Horizon (upstream, or your failover) is confirmed healthy via
   `curl "$HORIZON_URL"`, confirm the backend agrees:
   ```bash
   curl -s http://localhost:3001/health/ready | jq
   ```
2. If the circuit breaker is still `OPEN` and Horizon has clearly recovered,
   it will self-close on its next probe within `CIRCUIT_PROBE_INTERVAL_MS`
   (default 30s) — no manual reset endpoint is required. If you need it
   closed immediately for a demo or drill, restart the backend process,
   which resets in-memory circuit state.
3. If you failed over to a backup `HORIZON_URL` in step 3 above and the
   primary has since recovered, decide whether to fail back now or during a
   lower-traffic window, and repeat the same env-update-and-restart steps in
   reverse.
4. Watch `/health` for a few minutes to confirm the `stellar` check stays
   `healthy` and doesn't flap back to `OPEN`.

## Escalation path

- If the outage is upstream and lasts more than 30 minutes, or affects the
  contract-invoke endpoint (`STELLAR_CONTRACT_ADDRESS` / `SOROBAN_RPC_URL`),
  escalate to the on-call lead and consider a status-page update for users.
- If a backup Horizon provider is not already provisioned and the outage is
  ongoing, escalate to engineering leadership to authorize an emergency
  paid-provider signup.
- If the "outage" turns out to be self-inflicted (bad deploy, leaked/expired
  credentials to a paid Horizon provider, DNS misconfiguration), treat it as
  a standard incident and follow `docs/runbook.md` §5 (Incident Response
  Protocol) in addition to this runbook.

## Post-incident actions

- [ ] Note total downtime/degradation window for the post-mortem.
- [ ] If you failed over to a backup Horizon URL, confirm you failed back
      (or deliberately decided to stay on the backup) and that `HORIZON_URL`
      is correct in every environment (not just the one you patched live).
- [ ] Check `getStreamFailures` / payment retry stats
      (`GET /api/v1/retry/:transactionId` type endpoints, see
      `backend/src/routes/retry.js`) for payments that failed during the
      window and may need manual follow-up — see
      [Stuck transaction recovery](stuck-transaction-recovery.md).
- [ ] If this is a recurring issue with the public Horizon fleet, file a
      follow-up to provision a dedicated/paid Horizon provider.
- [ ] Write a post-mortem within 48 hours per `docs/runbook.md` §5.5.
