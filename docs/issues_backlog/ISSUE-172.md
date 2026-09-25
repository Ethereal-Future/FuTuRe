# frontend/api/client.js: Thundering herd of concurrent 401s breaks refresh token rotation and logs users out

**Domain:** Frontend & Authentication  
**Complexity:** Hard  
**Labels:** `bug`, `frontend`, `auth`, `concurrency`  
**Issue ID:** ISSUE-172

---

## Background
In `frontend/src/api/client.js` (lines 88-106):
```javascript
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/api/auth/refresh')
    ) {
      originalRequest._retry = true;
      try {
        const newToken = await refreshAccessToken();
        if (newToken && originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
        }
        return apiClient(originalRequest);
      } catch (refreshError) {
        return Promise.reject(normalizeAxiosError(refreshError));
      }
    }
```
When an access token expires, multiple parallel API requests (e.g. balance check, notification fetch, exchange rate poll) encounter HTTP 401 at the same time.

## Problem
- Because there is no pending refresh token promise queue, all concurrent requests simultaneously invoke `refreshAccessToken()`.
- Multiple parallel `POST /api/auth/refresh` calls are sent to the backend.
- Since the backend enforces single-use refresh token rotation (to prevent token theft), the first refresh call succeeds and rotates the refresh token.
- The subsequent parallel refresh calls submit the now-invalidated prior token. The backend detects token reuse, immediately revokes the entire session, and returns 403/401!
- The user is abruptly logged out in the middle of active wallet operations!

## Proposed Solution
1. Implement an in-flight refresh promise lock and request subscriber queue in `frontend/src/api/client.js`:
```javascript
let isRefreshing = false;
let refreshSubscribers = [];

function subscribeTokenRefresh(cb) {
  refreshSubscribers.push(cb);
}

function onRefreshed(token) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}
```
2. When the first 401 occurs, set `isRefreshing = true` and execute the single refresh request.
3. Queue all subsequent 401 requests until the single refresh request completes, then replay them with the new token.

## Implementation Steps
1. Implement request queueing and mutex locking around `refreshAccessToken` in `frontend/src/api/client.js`.
2. Reject queued requests and redirect to login only if the single refresh call fails.
3. Add integration test simulating 5 simultaneous 401 API calls and assert only 1 refresh request is made.

## Acceptance Criteria
- [ ] Only one `POST /api/auth/refresh` request is dispatched when multiple requests receive 401.
- [ ] All pending requests are paused and successfully retried with the newly minted access token.
- [ ] Users are never prematurely logged out due to parallel request races.

## Notes
- **Complexity Rating:** Hard
- **Subsystem Notes:** Fixes one of the most frustrating session bugs in multi-tab / parallel request web apps.

**GitHub Issue:** [1419](https://github.com/Ethereal-Future/FuTuRe/issues/1419)
