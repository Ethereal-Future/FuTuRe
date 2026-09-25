# notifications/service.js: In-app notification delivery does not prune stale read notifications, causing unbounded growth of notification records

**Domain:** Webhooks & Delivery  
**Complexity:** Medium  
**Labels:** `bug`, `notifications`, `database`, `performance`  
**Issue ID:** ISSUE-103

---

## Background
In `backend/src/notifications/service.js`, in-app notifications are stored in `prisma.notification`:
```javascript
await prisma.notification.create({
  data: { userId, type, title, body, data, read: false, createdAt: new Date() }
});
```
Users mark notifications as read via `PUT /api/notifications/:id/read`.

## Problem
- Read notifications and historical notifications are never pruned or deleted.
- Active users accumulate thousands of read notifications over months of activity.
- The `NotificationBell.jsx` component and dashboard queries (`GET /api/notifications`) become slower as the database scans large user notification histories.
- Database storage bloats with months of obsolete transaction alerts and marketing announcements.

## Proposed Solution
Implement an automatic notification retention and cleanup policy:
1. Retain read notifications for 30 days, and unread notifications for 90 days.
2. Add a scheduled daily cleanup worker in `backend/src/scheduler.js`:
```javascript
const readCutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
const unreadCutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000);
await prisma.notification.deleteMany({
  where: {
    OR: [
      { read: true, createdAt: { lte: readCutoff } },
      { read: false, createdAt: { lte: unreadCutoff } },
    ]
  }
});
```
3. Add pagination (`take: 20`, cursor) to `GET /api/notifications`.

## Implementation Steps
1. Add `cleanupStaleNotifications()` task in `backend/src/notifications/service.js`.
2. Register scheduled cron job in `scheduler.js`.
3. Add composite index `@@index([userId, read, createdAt])` in `prisma/schema.prisma`.
4. Update notification route to support keyset pagination.
5. Add tests verifying deletion of records older than retention cutoff.

## Acceptance Criteria
- [ ] Read notifications older than 30 days are automatically pruned.
- [ ] Notification list queries are indexed and paginated.
- [ ] Notification storage growth remains bounded.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1350](https://github.com/Ethereal-Future/FuTuRe/issues/1350)
