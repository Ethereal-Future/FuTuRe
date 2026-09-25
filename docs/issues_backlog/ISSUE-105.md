# notifications/channels/email.js: Email dispatch lacks DKIM signing and SPF alignment configuration, causing transactional emails to land in spam

**Domain:** Webhooks & Delivery  
**Complexity:** Medium  
**Labels:** `enhancement`, `notifications`, `email`, `infrastructure`  
**Issue ID:** ISSUE-105

---

## Background
In `backend/src/notifications/channels/email.js`, emails are dispatched via Nodemailer or AWS SES:
```javascript
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});
```

## Problem
- The mailer does not configure DomainKeys Identified Mail (DKIM) signing in Nodemailer (`dkim: { domainName, keySelector, privateKey }`).
- Major mail providers (Google Gmail, Microsoft Outlook, Yahoo) enforce strict DMARC/DKIM requirements for transactional senders as of 2024.
- Without DKIM keys signed with the platform's verified sending domain, all payment confirmations, 2FA codes, and password reset emails are rejected or routed to the user's spam/junk folder.
- Users are unable to complete login or verify transactions.

## Proposed Solution
1. Support DKIM signing in `email.js` using `nodemailer.dkim` options configured via environment variables (`DKIM_DOMAIN`, `DKIM_KEY_SELECTOR`, `DKIM_PRIVATE_KEY`).
2. Document required DNS records (SPF: `v=spf1 include:amazonses.com ~all`, DMARC: `v=DMARC1; p=reject;`, and DKIM CNAMEs) in `docs/guides/email-setup.md`.
3. In `infra/`, provision AWS SES domain identity and automated Easy DKIM DNS records in Route53.

## Implementation Steps
1. Add DKIM signing configuration to Nodemailer transporter in `backend/src/notifications/channels/email.js`.
2. Add DKIM environment variables to `config/env.js` and `infra/secrets.tf`.
3. Write DNS configuration guide in `docs/guides/email-setup.md`.
4. Add test asserting outgoing email envelopes include DKIM signature headers.

## Acceptance Criteria
- [ ] Transactional emails are signed with valid DKIM keys.
- [ ] SPF and DMARC alignment requirements are satisfied.
- [ ] Email inbox deliverability rate reaches >98%.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1352](https://github.com/Ethereal-Future/FuTuRe/issues/1352)
