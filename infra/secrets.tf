# ── AWS Secrets Manager ───────────────────────────────────────────────────────
# Secrets are created empty here and populated out-of-band (manually or via CI).
# The ECS task definition references them by ARN — no secret values ever appear
# in Terraform state or source control.

resource "aws_secretsmanager_secret" "jwt_secret" {
  name                    = "${local.name_prefix}/jwt-secret"
  description             = "JWT signing secret for the backend."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "stream_encryption_key" {
  name                    = "${local.name_prefix}/stream-encryption-key"
  description             = "32-byte hex key for encrypting payment stream secrets."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "backup_enc_key" {
  name                    = "${local.name_prefix}/backup-enc-key"
  description             = "32-byte hex key for AES-256-GCM backup encryption."
  recovery_window_in_days = 7
}
