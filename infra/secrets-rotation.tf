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
      # Allow forcing new ECS deployment for the backend service
      {
        Effect = "Allow"
        Action = "ecs:UpdateService"
        Resource = aws_ecs_service.backend.arn
      }
    ]
  })
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
    }
  }

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.ecs_tasks.id]
  }
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