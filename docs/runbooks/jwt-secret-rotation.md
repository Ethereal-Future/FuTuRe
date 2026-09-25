# Runbook: JWT Secret Rotation

## Overview

API authentication is signed with a single symmetric secret,
`JWT_SECRET` (HS256), read in `backend/src/auth/tokens.js`
(`signAccessToken`, `signRefreshToken`, `verifyToken`) via
`getConfig().security.jwtSecret`. There is currently
**no dual-secret / grace-period support for JWT** — `verifyToken` checks a
single secret, so rotating it invalidates every previously issued access and
refresh token immediately. This is different from the webhook signing
secret, which *does* support graceful rotation (see
`backend/src/webhooks/store.js`'s `previousSecrets` array,
`rotateWebhookSecret`) — that module is the reference implementation to
follow if/when JWT rotation gets the same treatment (tracked as a follow-up;
see [Notes](#notes)).

Because of this, JWT secret rotation today is a **hard cutover**: every
logged-in user is signed out and must log in again. Plan for it accordingly.

You'll rotate the JWT secret for one of two reasons:

- **Scheduled rotation** — routine credential hygiene. Can be scheduled
  during a low-traffic window with user communication in advance.
- **Suspected compromise** — the secret leaked (committed to source control,
  exposed in logs, found in a compromised CI runner, etc.). This is
  time-sensitive; rotate immediately per `docs/runbook.md` §5.3.

## Indicators

You'll typically arrive at this runbook from one of:

- A secret-scanning alert (GitHub secret scanning, `git log` audit, a
  leaked `.env` file) flagging `JWT_SECRET`.
- The incident response protocol in `docs/runbook.md` §5.3, which calls for
  rotating `JWT_SECRET` as a containment step for `UNAUTHORIZED_ACCESS`
  incidents.
- A scheduled security calendar reminder for periodic credential rotation.

## Immediate mitigation (suspected compromise only)

If the secret is suspected compromised, treat it as leaked immediately —
per `docs/api-auth.md` §"Security Best Practices", a published secret is
compromised even if you rotate it later, because logs/history may retain it.
Move straight to [Resolution](#resolution); there is no lower-impact interim
mitigation available (e.g. you cannot selectively revoke individual tokens
signed with a leaked secret without rotating it — see the `Session` table
note below).

## Root cause investigation

- Determine how the secret was exposed: committed to git (check `git log -S
  JWT_SECRET -- '*.env*'` and any public forks/mirrors), leaked in
  application logs (the logger's `sanitizeLogData` should redact known
  secret env vars — confirm `JWT_SECRET` is covered if it turns up in a log
  line), or exposed via a compromised CI/deploy credential.
- If via git history, treat the secret as permanently compromised even after
  a force-push/history rewrite — assume it was cloned or scraped.
- Check `Session` table activity (`backend/prisma/schema.prisma`) around the
  suspected exposure window for anomalous `ipAddress`/`userAgent` patterns
  that might indicate the leaked secret was already used to forge tokens.

## Resolution

1. **Generate a new, high-entropy secret:**
   ```bash
   openssl rand -hex 64
   ```
2. **Update `JWT_SECRET`** in the backend environment / secrets manager for
   every environment that needs it (production, staging — do not reuse
   secrets across environments).
3. **Restart every running backend instance** — the secret is read once at
   process start via `getConfig()`, so a config reload alone (even with
   `CONFIG_WATCH=true`) is not guaranteed sufficient; restart to be certain:
   ```bash
   # Per instance (see docs/runbook.md §1)
   kill $(lsof -ti tcp:3001)
   cd backend && node src/server.js &
   ```
   In a multi-instance deployment, restart all instances close together —
   an instance still running the old secret will keep issuing/accepting
   tokens signed with it until it restarts, which reopens the exposure
   window you're trying to close.
4. **Confirm the cutover:** old tokens should now be rejected.
   ```bash
   # Using a token issued before rotation — expect 401
   curl -i -H "Authorization: Bearer <old-token>" http://localhost:3001/api/v1/some-authenticated-route
   ```
5. **Communicate to users** that they've been signed out and need to log in
   again — this is expected and not itself an error. If you have a status
   page or in-app notice mechanism, use it; there's no way to avoid the
   forced logout with the current single-secret implementation.
6. **Optionally revoke `Session` rows** proactively for extra assurance
   (they'll fail on next use anyway once the JWT itself is rejected, but
   explicit revocation makes audit trails cleaner):
   ```bash
   cd backend
   node --input-type=module <<'EOF'
   import prisma from './src/db/client.js';
   const { count } = await prisma.session.updateMany({
     where: { revokedAt: null },
     data: { revokedAt: new Date() },
   });
   console.log(`Revoked ${count} sessions`);
   await prisma.$disconnect();
   EOF
   ```

## Escalation path

- Suspected compromise is a security incident — follow `docs/runbook.md`
  §5 (Incident Response Protocol) in parallel with this runbook: open an
  incident record, assess severity, and notify the security lead.
- If rotation doesn't fully cut off old tokens (step 4 still returns 200 for
  an old token after all instances restarted), escalate immediately — this
  means an instance is still running with the old secret, is caching config
  in a way that survived restart, or `getConfig()` has a fallback path
  returning a stale value; do not close the incident until this is resolved.
- If the leak involved CI/deploy credentials (not just the JWT secret
  itself), escalate to rotate those credentials too — a JWT secret rotation
  alone doesn't address a compromised deploy pipeline.

## Post-incident actions

- [ ] Confirm every backend instance and environment picked up the new
      secret (spot-check `/health` doesn't need auth, so verify via a
      protected route returning 401 for pre-rotation tokens instead).
- [ ] Audit how the secret was stored/exposed and close that gap (move to a
      secrets manager if it was in a plain `.env` file that got committed or
      copied somewhere it shouldn't have been).
- [ ] Update the secret-scanning allowlist/rules if the alert that caught
      this needs tuning.
- [ ] Review `GET /api/v1/security/audit-log` for the exposure window for
      any signs of misuse before rotation took effect.
- [ ] Write a post-mortem within 48 hours per `docs/runbook.md` §5.5.

## Notes

The forced-logout-for-everyone behavior described here is a real gap: a
graceful rotation should accept tokens signed with either the current or a
recent previous secret for a grace period, exactly like
`backend/src/webhooks/store.js` already does for webhook signing secrets
(`previousSecrets`, capped at 2, checked in `verifyWebhookSignature`). If
your team decides to invest in that, the shape of the change is:

1. Add `JWT_SECRET_PREVIOUS` (or a small rotation history, mirroring the
   webhook pattern) alongside `JWT_SECRET`.
2. In `verifyToken` (`backend/src/auth/tokens.js`), try the current secret
   first, then fall back to the previous one(s) before rejecting.
3. Keep signing new tokens with only the current secret
   (`signAccessToken`/`signRefreshToken` don't need to change).
4. Retire the previous secret once its longest-lived token type (7-day
   refresh tokens) has had time to expire.

Until that lands, this runbook's hard-cutover procedure is the supported
path.
