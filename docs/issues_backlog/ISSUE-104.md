# notifications/templates.js: Notification template interpolation uses unsafe regex replacement vulnerable to prototype pollution or injection

**Domain:** Webhooks & Delivery  
**Complexity:** Medium  
**Labels:** `bug`, `security`, `notifications`  
**Issue ID:** ISSUE-104

---

## Background
In `backend/src/notifications/templates.js`, template variables are substituted using global regex replace:
```javascript
export function renderTemplate(templateStr, data) {
  return templateStr.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return data[key] !== undefined ? String(data[key]) : match;
  });
}
```

## Problem
- If `key` matches Object prototype properties (e.g. `{{toString}}`, `{{valueOf}}`, `{{__proto__}}`), `data[key]` resolves to a function reference on the prototype:
  `String(data['toString'])` returns `"function toString() { [native code] }"`!
- If user input (such as a recipient memo or transaction note) contains HTML tags or script injection and the rendered template is output in HTML emails, it creates an HTML / Cross-Site Scripting (XSS) injection vulnerability in email clients.
- There is no HTML entity escaping applied to interpolated values.

## Proposed Solution
1. Check `Object.prototype.hasOwnProperty.call(data, key)` before reading properties to prevent prototype pollution lookups.
2. Apply HTML entity encoding (`escapeHtml(val)`) to all template variables when rendering HTML email templates:
```javascript
function escapeHtml(str) {
  return String(str).replace(/[&<>'"/]/g, s => ENTITY_MAP[s]);
}
```
3. Support plain-text and HTML versions of every notification template.

## Implementation Steps
1. Add `escapeHtml` utility in `backend/src/utils/sanitize.js`.
2. Update `renderTemplate` in `templates.js` to guard against prototype properties and escape HTML for email channels.
3. Add unit tests with prototype keys (`toString`, `constructor`) asserting they are not resolved.
4. Add unit tests with XSS payloads (`<script>alert(1)</script>`) asserting proper HTML escaping.

## Acceptance Criteria
- [ ] Template interpolation is immune to prototype pollution lookups.
- [ ] HTML email templates escape all dynamic user inputs.
- [ ] Email client XSS vulnerabilities are prevented.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1351](https://github.com/Ethereal-Future/FuTuRe/issues/1351)
