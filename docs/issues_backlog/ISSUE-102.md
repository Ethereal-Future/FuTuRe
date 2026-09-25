# notifications/preferences.js: User notification preference updates lack validation for quiet-hour timezone offsets and channel delivery rules

**Domain:** Webhooks & Delivery  
**Complexity:** Medium  
**Labels:** `bug`, `notifications`, `validation`  
**Issue ID:** ISSUE-102

---

## Background
In `backend/src/notifications/preferences.js`, users configure notification channels and quiet hours (e.g. `quietHoursStart = 22`, `quietHoursEnd = 7`).
In `isChannelEnabled()`:
```javascript
const currentHour = new Date().getUTCHours();
if (pref.quietHoursStart && pref.quietHoursEnd) {
  if (currentHour >= pref.quietHoursStart || currentHour < pref.quietHoursEnd) {
    return false;
  }
}
```

## Problem
- `isChannelEnabled()` compares `currentHour` in UTC against `pref.quietHoursStart` without converting to the user's local timezone.
- A user living in New York (UTC-5) who sets quiet hours from 22:00 to 07:00 (local time) will have quiet hours enforced from 22:00 to 07:00 UTC (which is 17:00 to 02:00 New York time, during their working afternoon!).
- Critical security notifications (e.g. new device login, failed payment) are suppressed during the middle of the day, while notifications buzz their phone at 03:00 AM!
- There is no `timezone` field in the user preference model.

## Proposed Solution
1. Add `timezone: String` (e.g. `'America/New_York'`) to `NotificationPreference` in Prisma schema (default: `'UTC'`).
2. Use `date-fns-tz` or `Intl.DateTimeFormat` to compute the user's local hour:
```javascript
const userLocalHour = new Date().toLocaleTimeString('en-US', { timeZone: pref.timezone, hour12: false, hour: 'numeric' });
```
3. Exclude critical security notifications (`login_new_device`, `password_reset`, `aml_freeze`) from quiet hours enforcement.

## Implementation Steps
1. Add `timezone` column to `NotificationPreference` model.
2. Refactor quiet-hour check in `preferences.js` to evaluate local user time.
3. Create a whitelist of emergency notification types that bypass quiet hours.
4. Add unit tests for users across multiple timezones (Tokyo, London, San Francisco).

## Acceptance Criteria
- [ ] Quiet hours are evaluated in the user's configured local timezone.
- [ ] Critical security alerts bypass quiet hours.
- [ ] Users receive daytime notifications reliably.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1349](https://github.com/Ethereal-Future/FuTuRe/issues/1349)
