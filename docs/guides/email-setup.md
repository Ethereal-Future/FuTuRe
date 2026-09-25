# Email Setup: SPF, DKIM and DMARC

Gmail, Outlook and Yahoo require transactional senders to pass SPF or DKIM, **aligned with the `From:` domain**, and to publish a DMARC policy. If mail fails these checks it is rejected or sent to spam. That breaks email verification, 2FA, password resets and payment confirmations.

This guide covers the DNS records and backend configuration needed for FutureRemit's outbound email (`backend/src/notifications/channels/email.js`).

## How signing works

There are two supported setups. Pick one.

| Setup | Who signs | Backend `DKIM_*` vars | Terraform |
| --- | --- | --- | --- |
| **AWS SES (recommended)** | SES Easy DKIM signs every message | Leave unset | Set `email_domain` + `route53_zone_id` |
| **Any other SMTP relay** | The backend signs with nodemailer | Set all three | Also set `dkim_key_selector` |

Both can be active at once. A message may carry more than one `DKIM-Signature` header, and receivers accept it if any one of them passes and aligns.

## Backend environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS` | yes | SMTP relay credentials. For SES, use the SES SMTP endpoint and SMTP credentials. |
| `EMAIL_FROM` | yes | `From:` address. **Its domain must be `DKIM_DOMAIN` or a subdomain of it**, or DMARC alignment fails. The backend logs `email.dkim.misaligned` at startup when they differ. |
| `DKIM_DOMAIN` | app signing only | Signing domain (`d=`), e.g. `futureremit.app`. |
| `DKIM_KEY_SELECTOR` | app signing only | Selector (`s=`), e.g. `fr2026`. The public key is published at `<selector>._domainkey.<domain>`. |
| `DKIM_PRIVATE_KEY` | app signing only | PEM-encoded RSA private key. In single-line env files, literal `\n` sequences are converted to newlines. |

The three `DKIM_*` variables must be set together. Setting only some of them, or setting a value that isn't a PEM key, makes config loading fail at startup (`src/config/env.js`). In production, if SMTP is configured without DKIM, the backend logs `email.dkim.disabled`.

### Generating an app signing key

```bash
openssl genrsa -out dkim-private.pem 2048
openssl rsa -in dkim-private.pem -pubout -outform der 2>/dev/null | openssl base64 -A > dkim-public.b64
```

Store `dkim-private.pem` in the `<name_prefix>/dkim-private-key` Secrets Manager secret. Publish the public key in DNS as shown below.

## DNS records

Replace `futureremit.app` with your sending domain and `us-east-1` with your SES region.

### DKIM

**SES Easy DKIM:** add three CNAMEs. SES generates the tokens, and Terraform creates these records automatically:

```
<token1>._domainkey.futureremit.app  CNAME  <token1>.dkim.amazonses.com
<token2>._domainkey.futureremit.app  CNAME  <token2>.dkim.amazonses.com
<token3>._domainkey.futureremit.app  CNAME  <token3>.dkim.amazonses.com
```

**App signing:** add one TXT record containing the public key:

```
fr2026._domainkey.futureremit.app  TXT  "v=DKIM1; k=rsa; p=<contents of dkim-public.b64>"
```

### SPF

SPF checks the **envelope sender** (Return-Path), not the `From:` header. For SPF to align with DMARC, SES is configured with a custom MAIL FROM subdomain (`mail.futureremit.app` by default):

```
mail.futureremit.app  MX   10 feedback-smtp.us-east-1.amazonses.com
mail.futureremit.app  TXT  "v=spf1 include:amazonses.com ~all"
```

If the root domain also sends mail directly, it needs its own SPF record listing every provider that sends as it:

```
futureremit.app  TXT  "v=spf1 include:amazonses.com ~all"
```

A domain must have only **one** SPF TXT record. Merge `include:` entries rather than adding a second record.

### DMARC

```
_dmarc.futureremit.app  TXT  "v=DMARC1; p=reject; adkim=r; aspf=r; rua=mailto:dmarc-reports@futureremit.app"
```

For a new domain, start with `p=none` and watch the `rua` aggregate reports for a week or two. Then move to `p=quarantine`, and finally `p=reject`. The Terraform variable `dmarc_policy` controls this.

## Terraform

`infra/ses.tf` provisions everything above when both of these variables are set:

```hcl
email_domain      = "futureremit.app"
route53_zone_id   = "Z0123456789ABCDEFGHIJ"
dmarc_policy      = "none"              # tighten to "reject" once reports are clean
dmarc_report_email = "dmarc-reports@futureremit.app"

# Only when using a non-SES SMTP relay with app-level signing:
# dkim_key_selector = "fr2026"
```

It creates:

- an SES domain identity with Easy DKIM (RSA 2048)
- the three DKIM CNAMEs
- a custom MAIL FROM domain with its MX and SPF records
- the DMARC record

When `dkim_key_selector` is set, it also creates the `dkim-private-key` secret and passes `DKIM_DOMAIN`, `DKIM_KEY_SELECTOR` and `DKIM_PRIVATE_KEY` into the ECS task. Populate the secret value before deploying, or the task will fail to start.

New SES accounts start in the sandbox and can only send to verified addresses. Request production access from the SES console.

## Verifying

1. `dig +short TXT _dmarc.futureremit.app`, `dig +short TXT mail.futureremit.app`, and `dig +short CNAME <token>._domainkey.futureremit.app` should all resolve.
2. The SES console should show the identity as **Verified** with DKIM status **Successful**.
3. Send a message to a Gmail account and open **Show original**. `SPF`, `DKIM` and `DMARC` should all read `PASS`, and the DKIM `d=` should match the `From:` domain.
4. Tools such as mail-tester.com or `check-auth@verifier.port25.com` give a full report.
