# ── Secrets Manager Rotation ──────────────────────────────────────────────────
# Automatic rotation for application secrets (JWT, stream encryption, backup encryption)
# with a Lambda that triggers ECS deployment to pick up new secrets.

# IAM role for the rotation Lambda
resource "aws_iam_role" "secrets_rotation_lambda" {
  name = "${local.name_prefix}-secrets-rotation-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

# Policy attachments for basic Lambda execution (CloudWatch Logs)
resource "aws_iam_role_policy_attachment" "secrets_rotation_lambda_basic" {
  role       = aws_iam_role.secrets_rotation_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ENI management so the Lambda can attach to the VPC private subnets
resource "aws_iam_role_policy_attachment" "secrets_rotation_lambda_vpc" {
  role       = aws_iam_role.secrets_rotation_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# Least-privilege policy for secrets access and ECS deployment
resource "aws_iam_role_policy" "secrets_rotation" {
  name = "${local.name_prefix}-secrets-rotation-policy"
  role = aws_iam_role.secrets_rotation_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # Allow reading and updating our specific secrets
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
          "secretsmanager:UpdateSecretVersionStage"
        ]
        Resource = [
          aws_secretsmanager_secret.jwt_secret.arn,
          aws_secretsmanager_secret.stream_encryption_key.arn,
          aws_secretsmanager_secret.backup_enc_key.arn
        ]
      },
      # Allow applying rotated database passwords to the RDS instance
      {
        Effect   = "Allow"
        Action   = "rds:ModifyDBInstance"
        Resource = aws_db_instance.postgres.arn
      },
      # Allow forcing new ECS deployment for the backend service
      {
        Effect = "Allow"
        Action = "ecs:UpdateService"
        Resource = aws_ecs_service.backend.arn
      }
    ]
  })
}

# ── Networking ────────────────────────────────────────────────────────────────
#
# The Lambda runs inside the private subnets so it can reach the private RDS
# instance (publicly_accessible = false). Rules are standalone resources (not
# inline) to avoid a dependency cycle with aws_security_group.rds, which
# references this group in its ingress.

resource "aws_security_group" "lambda_rotation" {
  name        = "${local.name_prefix}-lambda-rotation-sg"
  description = "Secrets rotation Lambda: egress to RDS and AWS APIs only."
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_egress_rule" "lambda_rotation_rds" {
  security_group_id            = aws_security_group.lambda_rotation.id
  description                  = "PostgreSQL to RDS"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.rds.id
}

# HTTPS for the Secrets Manager VPC endpoint and the ECS API (via NAT).
resource "aws_vpc_security_group_egress_rule" "lambda_rotation_https" {
  security_group_id = aws_security_group.lambda_rotation.id
  description       = "HTTPS to AWS APIs"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_security_group" "vpc_endpoints" {
  name        = "${local.name_prefix}-vpc-endpoints-sg"
  description = "Allow HTTPS to interface VPC endpoints from in-VPC workloads."
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port = 443
    to_port   = 443
    protocol  = "tcp"
    security_groups = [
      aws_security_group.lambda_rotation.id,
      aws_security_group.ecs_tasks.id,
    ]
  }
}

# Private DNS makes the default secretsmanager.<region>.amazonaws.com hostname
# resolve to the endpoint ENIs, so boto3 needs no endpoint_url override and
# Secrets Manager traffic never leaves the VPC.
resource "aws_vpc_endpoint" "secretsmanager" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.secretsmanager"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints.id]

  tags = { Name = "${local.name_prefix}-secretsmanager-vpce" }
}

# Create zip archive of the rotation Lambda code
data "archive_file" "secrets_rotation_zip" {
  type        = "zip"
  source_file = "${path.module}/secrets_rotation.py"
  output_path = "${path.module}/secrets_rotation.zip"
}

# Rotation Lambda function
resource "aws_lambda_function" "secrets_rotation" {
  filename      = data.archive_file.secrets_rotation_zip.output_path
  function_name = "${local.name_prefix}-secrets-rotation"
  role          = aws_iam_role.secrets_rotation_lambda.arn
  handler       = "secrets_rotation.lambda_handler"
  runtime       = "python3.12"
  source_code_hash = data.archive_file.secrets_rotation_zip.output_base64sha256

  environment {
    variables = {
      ECS_CLUSTER = aws_ecs_cluster.main.name
      ECS_SERVICE = aws_ecs_service.backend.name
      # Fallback for JSON DB secrets that lack a dbInstanceIdentifier field
      DB_INSTANCE_IDENTIFIER = aws_db_instance.postgres.identifier
    }
  }

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda_rotation.id]
  }

  depends_on = [
    aws_iam_role_policy_attachment.secrets_rotation_lambda_vpc,
    aws_vpc_endpoint.secretsmanager,
  ]
}

# Permission for Secrets Manager to invoke our rotation Lambda
resource "aws_lambda_permission" "secrets_manager_invoke" {
  statement_id  = "AllowSecretsManagerRotation"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.secrets_rotation.function_name
  principal     = "secretsmanager.amazonaws.com"
  source_arn    = aws_secretsmanager_secret.jwt_secret.arn
}

# Additional permissions for the other two secrets
resource "aws_lambda_permission" "secrets_manager_invoke_stream" {
  statement_id  = "AllowSecretsManagerRotationStream"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.secrets_rotation.function_name
  principal     = "secretsmanager.amazonaws.com"
  source_arn    = aws_secretsmanager_secret.stream_encryption_key.arn
}

resource "aws_lambda_permission" "secrets_manager_invoke_backup" {
  statement_id  = "AllowSecretsManagerRotationBackup"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.secrets_rotation.function_name
  principal     = "secretsmanager.amazonaws.com"
  source_arn    = aws_secretsmanager_secret.backup_enc_key.arn
}

# Rotation configuration for each secret - rotate every 90 days
resource "aws_secretsmanager_secret_rotation" "jwt_secret" {
  secret_id           = aws_secretsmanager_secret.jwt_secret.id
  rotation_lambda_arn = aws_lambda_function.secrets_rotation.arn

  rotation_rules {
    automatically_after_days = 90
  }
}

resource "aws_secretsmanager_secret_rotation" "stream_encryption_key" {
  secret_id           = aws_secretsmanager_secret.stream_encryption_key.id
  rotation_lambda_arn = aws_lambda_function.secrets_rotation.arn

  rotation_rules {
    automatically_after_days = 90
  }
}

resource "aws_secretsmanager_secret_rotation" "backup_enc_key" {
  secret_id           = aws_secretsmanager_secret.backup_enc_key.id
  rotation_lambda_arn = aws_lambda_function.secrets_rotation.arn

  rotation_rules {
    automatically_after_days = 90
  }
}