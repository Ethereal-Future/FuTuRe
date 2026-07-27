# API Authentication Guide

This guide explains how to authenticate with the FuTuRe REST API. It covers every step of the authentication lifecycle — from obtaining credentials, to making authenticated requests, to refreshing tokens, to handling errors.

---

## Table of Contents

1. [Authentication model](#1-authentication-model)
2. [Obtaining credentials](#2-obtaining-credentials)
3. [Authenticating — getting tokens](#3-authenticating--getting-tokens)
4. [Using the access token](#4-using-the-access-token)
5. [Token lifetime and refresh](#5-token-lifetime-and-refresh)
6. [Session management](#6-session-management)
7. [Alternative authentication methods](#7-alternative-authentication-methods)
8. [CSRF protection](#8-csrf-protection)
9. [Error reference](#9-error-reference)
10. [Security best practices](#10-security-best-practices)

---

## 1. Authentication model

The FuTuRe API uses **JWT Bearer tokens** (JSON Web Tokens, RFC 7519). Every protected endpoint requires an `Authorization` header containing a short-lived access token.

The flow is:

```
POST /api/auth/login
  → returns: { accessToken }
  → sets:    HttpOnly cookie: refreshToken

Attach accessToken to protected requests:
  Authorization: Bearer <accessToken>

Before accessToken expires (15 min), refresh it:
POST /api/auth/refresh  (sends the refreshToken cookie automatically)
  → returns: { accessToken }
  → rotates: refreshToken cookie
```

Key properties of this model:

| Property | Value |
|---|---|
| Token format | JWT (HS256) |
| Access token lifetime | 15 minutes |
| Refresh token lifetime | 7 days |
| Refresh delivery mechanism | HttpOnly, Secure, SameSite=Strict cookie |
| Session validation | Each request validates the session against the database |
| Account lockout | After repeated failed logins (HTTP 423) |

---

## 2. Obtaining credentials

### Creating an account

Register a new account with a username and password:

```bash
curl -s -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username": "alice", "password": "S3cur3P@ss!"}'
```

**Requirements:**

- `username` — 3–32 characters
- `password` — minimum 8 characters

**Success response (201):**

```json
{
  "user": {
    "id": "usr_01HX",
    "username": "alice",
    "createdAt": "2026-07-27T10:00:00.000Z"
  }
}
```

**Error — username already taken (409):**

```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "User already exists"
  }
}
```

> **Rate limit:** Registration and login share a limit of **5 requests per 15 minutes** per IP. Exceeding this returns HTTP 429.

---

## 3. Authenticating — getting tokens

### Login

```bash
curl -s -c cookies.txt -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "alice", "password": "S3cur3P@ss!"}'
```

The `-c cookies.txt` flag saves the `refreshToken` cookie — keep this file secure.

**Success response (200):**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "sessionId": "ses_abc123"
}
```

The `refreshToken` is not in the response body. It is set as an `HttpOnly` cookie scoped to `/api/auth`, so it is never accessible to JavaScript and is sent automatically with subsequent requests to that path.

**Account locked (423):**

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Account is temporarily locked due to too many failed login attempts",
    "details": { "retryAfter": 900 }
  }
}
```

The `Retry-After` response header contains the same value in seconds.

---

## 4. Using the access token

Attach the access token to every protected request using the `Authorization` header with the `Bearer` scheme.

### curl

```bash
ACCESS_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -s http://localhost:3001/api/auth/profile \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

### fetch (browser / Node.js)

```javascript
const response = await fetch('http://localhost:3001/api/auth/profile', {
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  credentials: 'include', // required for the refreshToken cookie
});
const data = await response.json();
```

### axios

```javascript
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3001',
  withCredentials: true, // required for the refreshToken cookie
});

// Set once after login, reuse for all requests
api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;

const { data } = await api.get('/api/auth/profile');
```

> **Note:** `credentials: 'include'` / `withCredentials: true` is required so the browser sends the `refreshToken` cookie on `/api/auth/refresh` calls. Without it, silent token refresh will not work.

---

## 5. Token lifetime and refresh

### Access token expiry

Access tokens are valid for **15 minutes**. When a token expires the API returns:

```http
HTTP/1.1 401 Unauthorized

{
  "success": false,
  "error": {
    "code": "AUTH_INVALID_TOKEN",
    "message": "Invalid or expired token"
  }
}
```

### Detecting expiry before it happens

The JWT payload contains a standard `exp` claim (Unix timestamp). You can decode the payload locally — without verifying the signature — to read `exp`:

```javascript
function getTokenExpiry(token) {
  const payload = JSON.parse(atob(token.split('.')[1]));
  return new Date(payload.exp * 1000);
}

function isExpiringSoon(token, bufferMs = 60_000) {
  return getTokenExpiry(token).getTime() - Date.now() < bufferMs;
}
```

A common pattern is to refresh the token when it has less than 60 seconds remaining.

### Refreshing the token

Call `POST /api/auth/refresh`. The `refreshToken` cookie is sent automatically by the browser (or by curl with `-b cookies.txt`). No request body is needed.

```bash
# curl — cookie jar from login step
curl -s -b cookies.txt -c cookies.txt -X POST http://localhost:3001/api/auth/refresh
```

```javascript
// fetch — browser sends the cookie automatically
const response = await fetch('http://localhost:3001/api/auth/refresh', {
  method: 'POST',
  credentials: 'include',
});
const { accessToken } = await response.json();
```

**Success response (200):**

```json
{ "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }
```

The refresh token is **rotated** on every successful refresh call — a new `refreshToken` cookie is set and the old one is invalidated. Always save the updated cookie.

**Refresh token expired or revoked (401):**

```json
{
  "success": false,
  "error": {
    "code": "AUTH_INVALID_TOKEN",
    "message": "Invalid or expired refresh token"
  }
}
```

When this happens the user must log in again. There is no silent recovery path.

### Recommended refresh strategy (axios interceptor)

```javascript
import axios from 'axios';

const api = axios.create({ baseURL: 'http://localhost:3001', withCredentials: true });

let isRefreshing = false;
let queue = [];

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error);
    }
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        queue.push({ resolve, reject });
      }).then((token) => {
        original.headers['Authorization'] = `Bearer ${token}`;
        return api(original);
      });
    }
    original._retry = true;
    isRefreshing = true;
    try {
      const { data } = await api.post('/api/auth/refresh');
      api.defaults.headers.common['Authorization'] = `Bearer ${data.accessToken}`;
      queue.forEach(({ resolve }) => resolve(data.accessToken));
      return api(original);
    } catch (refreshError) {
      queue.forEach(({ reject }) => reject(refreshError));
      // Redirect to login
      window.location.href = '/login';
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
      queue = [];
    }
  }
);
```

---

## 6. Session management

Each login creates a server-side session. Sessions are tracked in the database and validated on every authenticated request. A token whose session has been revoked will be rejected even if the JWT itself has not expired.

### List active sessions

```bash
curl -s http://localhost:3001/api/auth/sessions \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

```json
{
  "sessions": [
    {
      "id": "ses_abc123",
      "device": "macOS",
      "ipAddress": "203.0.113.1",
      "lastActiveAt": "2026-07-27T10:30:00.000Z",
      "createdAt": "2026-07-27T09:00:00.000Z",
      "current": true
    }
  ]
}
```

### Revoke a specific session

```bash
curl -s -X DELETE http://localhost:3001/api/auth/sessions/ses_abc123 \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

### Revoke all other sessions (logout everywhere)

```bash
curl -s -X DELETE http://localhost:3001/api/auth/sessions \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

### Logout (current session)

```bash
curl -s -b cookies.txt -X POST http://localhost:3001/api/auth/logout \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

This revokes the current session and clears the `refreshToken` cookie.

---

## 7. Alternative authentication methods

### Stellar SEP-0010 (wallet authentication)

Accounts that have a Stellar keypair can authenticate without a username and password using the SEP-0010 challenge–response flow.

**Step 1 — Get a challenge transaction:**

```bash
curl -s "http://localhost:3001/api/auth/stellar/challenge?account=GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN"
```

```json
{
  "transaction": "<base64 XDR>",
  "network_passphrase": "Test SDF Network ; September 2015",
  "network": "testnet"
}
```

**Step 2 — Sign the transaction with your Stellar secret key**, then submit the signed XDR:

```bash
curl -s -X POST http://localhost:3001/api/auth/stellar/token \
  -H "Content-Type: application/json" \
  -d '{"transaction": "<signed base64 XDR>"}'
```

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

Use the returned `accessToken` exactly as described in [section 4](#4-using-the-access-token).

> The challenge expires after **5 minutes**. Submit the signed transaction before it times out.

### Google OAuth 2.0

Redirect the user to:

```
GET /api/auth/oauth/google
```

After the user consents, Google redirects back to your registered callback URI. The API will redirect the user to the configured `FRONTEND_BASE_URL` with `accessToken` and `refreshToken` as query parameters. Store these securely and immediately remove them from the URL bar.

### Multi-factor authentication (TOTP)

MFA can be enabled on any account. Once enabled, successful password authentication alone is insufficient — the session token issued at login is a limited-privilege token until the TOTP code is verified.

```bash
# Initiate MFA setup
curl -s -X POST http://localhost:3001/api/auth/mfa/setup \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"totp": "123456", "secret": "<TOTP secret from your authenticator app>"}'
```

---

## 8. CSRF protection

All state-mutating requests (POST, PUT, DELETE) that originate from a browser must include a CSRF token. Curl-based integrations running server-to-server are typically exempt because they do not use cookies for authentication — but any browser-based integration must follow this flow.

**Step 1 — Fetch a CSRF token on app initialisation:**

```bash
curl -s http://localhost:3001/api/auth/csrf-token
```

```json
{ "csrfToken": "abc123def456..." }
```

Store the token in memory (not `localStorage`).

**Step 2 — Include it in every mutating request:**

```javascript
await fetch('http://localhost:3001/api/payments', {
  method: 'POST',
  credentials: 'include',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken,
  },
  body: JSON.stringify({ ... }),
});
```

CSRF tokens expire after 24 hours. Refresh after login and after each successful mutation.

---

## 9. Error reference

All error responses share the same envelope:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "requestId": "uuid"
  }
}
```

### Authentication error codes

| HTTP status | `error.code` | Meaning | Remediation |
|---|---|---|---|
| 401 | `AUTH_INVALID_TOKEN` | Token is malformed, has an invalid signature, or the session has been revoked | Re-authenticate or refresh the token |
| 401 | `AUTH_TOKEN_EXPIRED` | JWT `exp` claim is in the past | Call `POST /api/auth/refresh` |
| 401 | `AUTH_INVALID_CREDENTIALS` | Username or password is incorrect | Check credentials; do not retry more than 5 times |
| 401 | `UNAUTHORIZED` | Request reached a protected endpoint without an `Authorization` header | Add `Authorization: Bearer <token>` |
| 403 | `FORBIDDEN` | The authenticated user does not have the required role or permission | Contact the platform to request elevated access |
| 409 | `CONFLICT` | Username is already registered | Choose a different username |
| 422 | `VALIDATION_INVALID_INPUT` | Request body failed validation (details in `error.details`) | Fix the fields listed in `error.details` |
| 422 | `VALIDATION_MISSING_FIELD` | A required field is absent | Add the missing field |
| 423 | `UNAUTHORIZED` | Account is temporarily locked after too many failed login attempts | Wait for the `Retry-After` seconds before retrying |
| 429 | `RATE_LIMITED` | Too many requests from this IP or for this email | Back off and retry after the `Retry-After` header value |
| 500 | `INTERNAL_ERROR` | Unexpected server error | Retry with exponential back-off; contact support if persistent |

### Common login error scenarios

**Missing Authorization header:**

```
HTTP/1.1 401
{ "error": "Missing or invalid Authorization header" }
```

Add `Authorization: Bearer <token>` to the request.

**Expired access token:**

```
HTTP/1.1 401
{ "success": false, "error": { "code": "AUTH_INVALID_TOKEN", "message": "Invalid or expired token" } }
```

Call `POST /api/auth/refresh` to get a new access token without prompting the user to re-authenticate.

**Refresh token missing or expired:**

```
HTTP/1.1 401
{ "success": false, "error": { "code": "AUTH_INVALID_TOKEN", "message": "Refresh token missing or expired" } }
```

The user must log in again.

---

## 10. Security best practices

### Store credentials safely

- Keep your `JWT_SECRET` and all credentials in environment variables or a secrets manager (AWS Secrets Manager, HashiCorp Vault). Never commit them to source control.
- Do not store access tokens in `localStorage` — XSS can read it. Prefer memory (a module-level variable or React state). The `refreshToken` is already stored in an HttpOnly cookie by the API, so it is never reachable from JavaScript.
- Treat a published secret as compromised immediately, even if the commit is reverted. Git history and CI logs may retain it.

### Use separate credentials per environment

Never share API credentials between development, staging, and production. Register a separate account for each environment. If a development credential is compromised, production is not affected.

### Rotate credentials after a suspected compromise

1. Call `DELETE /api/auth/sessions` to revoke all active sessions.
2. Call `POST /api/auth/logout` to invalidate the current refresh token cookie.
3. Change the account password via `POST /api/auth/password-reset`.
4. Rotate the server-side `JWT_SECRET` in the backend environment and restart the service — this invalidates **all** existing tokens platform-wide. Coordinate with the team before doing this in production.

### Implement token refresh proactively

Do not wait for a 401 to refresh. Check the `exp` claim and refresh when the token has less than 60 seconds remaining. This avoids failed requests during peak traffic.

### Apply least-privilege

Request only the access your integration needs. Do not authenticate as an admin account for routine operations.

### Never log tokens

Ensure your logging infrastructure does not capture `Authorization` header values or response bodies that contain tokens. Treat tokens the same as passwords.

### Enable MFA on integration accounts

For accounts used by automated integrations, enabling TOTP-based MFA adds a second factor that protects against credential theft.

### Use HTTPS in production

All requests in production must go over HTTPS. The `refreshToken` cookie is marked `Secure` in production — it will not be sent over plain HTTP.

---

## Related documentation

- [Security best practices for integrators](guides/security.md)
- [Operational runbook](runbook.md) — JWT secret rotation and incident response
- [Backend configuration reference](../backend/CONFIGURATION.md)
