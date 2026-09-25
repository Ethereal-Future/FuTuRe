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

# Only needed when the backend DKIM-signs mail itself (non-SES SMTP relay).
# With SES Easy DKIM (see ses.tf) SES signs outbound mail and this is not created.
resource "aws_secretsmanager_secret" "dkim_private_key" {
  count                   = local.app_dkim_enabled ? 1 : 0
  name                    = "${local.name_prefix}/dkim-private-key"
  description             = "PEM-encoded RSA private key used by the backend to DKIM-sign outbound email (DKIM_PRIVATE_KEY)."
  recovery_window_in_days = 7
}
# Redis AUTH token. Unlike jwt_secret (populated out-of-band), ElastiCache
# needs the plaintext token on the replication group, so we generate it here
# and store a copy in Secrets Manager for the ECS task to consume. The value
# lives in Terraform state (encrypt the remote backend) and Secrets Manager —
# never in source control.
resource "random_password" "redis_auth" {
  length           = 32
  special          = true
  override_special = "!#$%^&*()-_=+[]{}"
  min_lower        = 1
  min_upper        = 1
  min_numeric      = 1
}

resource "aws_secretsmanager_secret" "redis_auth_token" {
  name                    = "${local.name_prefix}/redis-auth-token"
  description             = "ElastiCache Redis AUTH token for the backend."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "redis_auth_token" {
  secret_id     = aws_secretsmanager_secret.redis_auth_token.id
  secret_string = random_password.redis_auth.result
}
