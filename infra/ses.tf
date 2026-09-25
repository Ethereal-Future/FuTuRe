# ── SES Sending Domain (issue #1352) ─────────────────────────────────────────
# Verifies the transactional sending domain in SES, enables Easy DKIM and a
# custom MAIL FROM domain, and publishes the DKIM / SPF / DMARC records to
# Route53 so outbound mail passes DMARC alignment.
# Everything here is skipped when var.email_domain is empty.
# See docs/guides/email-setup.md for the full DNS reference.

locals {
  ses_enabled      = var.email_domain != "" && var.route53_zone_id != ""
  mail_from_domain = "${var.email_mail_from_subdomain}.${var.email_domain}"

  # App-level DKIM signing (nodemailer) for non-SES SMTP relays
  app_dkim_enabled = var.email_domain != "" && var.dkim_key_selector != ""
}

resource "aws_sesv2_email_identity" "sending_domain" {
  count          = local.ses_enabled ? 1 : 0
  email_identity = var.email_domain

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

# Easy DKIM: three CNAMEs pointing at SES-managed public keys
resource "aws_route53_record" "ses_dkim" {
  count   = local.ses_enabled ? 3 : 0
  zone_id = var.route53_zone_id
  name    = "${aws_sesv2_email_identity.sending_domain[0].dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.email_domain}"
  type    = "CNAME"
  ttl     = 1800
  records = ["${aws_sesv2_email_identity.sending_domain[0].dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

# Custom MAIL FROM so the envelope sender (Return-Path) aligns with the From domain for SPF
resource "aws_sesv2_email_identity_mail_from_attributes" "sending_domain" {
  count                  = local.ses_enabled ? 1 : 0
  email_identity         = aws_sesv2_email_identity.sending_domain[0].email_identity
  mail_from_domain       = local.mail_from_domain
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

resource "aws_route53_record" "ses_mail_from_mx" {
  count   = local.ses_enabled ? 1 : 0
  zone_id = var.route53_zone_id
  name    = local.mail_from_domain
  type    = "MX"
  ttl     = 1800
  records = ["10 feedback-smtp.${var.aws_region}.amazonses.com"]
}

resource "aws_route53_record" "ses_mail_from_spf" {
  count   = local.ses_enabled ? 1 : 0
  zone_id = var.route53_zone_id
  name    = local.mail_from_domain
  type    = "TXT"
  ttl     = 1800
  records = ["v=spf1 include:amazonses.com ~all"]
}

resource "aws_route53_record" "dmarc" {
  count   = local.ses_enabled ? 1 : 0
  zone_id = var.route53_zone_id
  name    = "_dmarc.${var.email_domain}"
  type    = "TXT"
  ttl     = 1800
  records = [
    "v=DMARC1; p=${var.dmarc_policy}; adkim=r; aspf=r;${var.dmarc_report_email != "" ? " rua=mailto:${var.dmarc_report_email};" : ""}"
  ]
}
