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

# Rotation Lambda function code (inline to keep everything in Terraform)
data "aws_iam_policy_document" "secrets_rotation_lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_lambda_function" "secrets_rotation" {
  filename      = "secrets_rotation.zip"
  function_name = "${local.name_prefix}-secrets-rotation"
  role          = aws_iam_role.secrets_rotation_lambda.arn
  handler       = "secrets_rotation.lambda_handler"
  runtime       = "python3.12"
  source_code_hash = filebase64sha256("${path.module}/secrets_rotation.py")

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

# Lambda function code file
# This implements the Secrets Manager rotation lifecycle + triggers ECS deployment
resource "local_file" "secrets_rotation_py" {
  content = <<EOF
import boto3
import json
import logging
import os
from typing import Dict, Any

logger = logging.getLogger()
logger.setLevel(logging.INFO)

secrets_manager = boto3.client('secretsmanager')
ecs = boto3.client('ecs')

def lambda_handler(event: Dict[str, Any], context: Any) -> None:
    """Handle Secrets Manager rotation lifecycle events."""
    logger.info(f"Received event: {json.dumps(event)}")
    
    step = event['Step']
    secret_id = event['SecretId']
    token = event['ClientRequestToken']
    
    try:
        if step == 'create-secret':
            create_secret(secret_id, token)
        elif step == 'set-secret':
            set_secret(secret_id, token)
        elif step == 'test-secret':
            test_secret(secret_id, token)
        elif step == 'finish-secret':
            finish_secret(secret_id, token)
        else:
            raise ValueError(f"Unknown rotation step: {step}")
    except Exception as e:
        logger.error(f"Rotation failed: {str(e)}", exc_info=True)
        raise

def create_secret(secret_id: str, token: str) -> None:
    """Step 1: Generate a new secret and stage it."""
    # Verify this is the pending version
    metadata = secrets_manager.describe_secret(SecretId=secret_id)
    if 'AWSPENDING' not in metadata.get('VersionIdsToStages', {}).get(token, []):
        logger.info(f"Secret {secret_id} already has pending version, skipping create")
        return
    
    # Generate new 32-byte hex secret (matches initial secret format)
    import secrets
    new_secret = secrets.token_hex(32)
    
    # Save the new secret as AWSPENDING
    secrets_manager.put_secret_value(
        SecretId=secret_id,
        ClientRequestToken=token,
        SecretString=new_secret,
        VersionStages=['AWSPENDING']
    )
    logger.info(f"Created new pending secret for {secret_id}")

def set_secret(secret_id: str, token: str) -> None:
    """Step 2: Mark the pending secret as AWSCURRENT."""
    metadata = secrets_manager.describe_secret(SecretId=secret_id)
    current_version = None
    for version, stages in metadata['VersionIdsToStages'].items():
        if 'AWSCURRENT' in stages:
            current_version = version
            break
    
    if not current_version:
        raise ValueError(f"No current version found for {secret_id}")
    
    # Update stages: move AWSCURRENT to new version, old becomes AWSPREVIOUS
    secrets_manager.update_secret_version_stage(
        SecretId=secret_id,
        VersionStage='AWSCURRENT',
        RemoveFromVersionId=current_version,
        MoveToVersionId=token
    )
    logger.info(f"Set new secret as current for {secret_id}")
    
    # Trigger ECS deployment to pick up the new secret
    _trigger_ecs_deployment()

def test_secret(secret_id: str, token: str) -> None:
    """Step 3: Verify the new secret is accessible (basic validation)."""
    # Simply verify we can retrieve the pending secret - app will validate it
    secrets_manager.get_secret_value(SecretId=secret_id, VersionId=token)
    logger.info(f"Test passed for {secret_id}")

def finish_secret(secret_id: str, token: str) -> None:
    """Step 4: Finalize rotation."""
    logger.info(f"Rotation completed successfully for {secret_id}")

def _trigger_ecs_deployment() -> None:
    """Force a new ECS deployment to pick up rotated secrets."""
    cluster = os.environ['ECS_CLUSTER']
    service = os.environ['ECS_SERVICE']
    
    logger.info(f"Triggering force new deployment for ECS service {service} in cluster {cluster}")
    ecs.update_service(
        cluster=cluster,
        service=service,
        forceNewDeployment=True
    )
    logger.info("ECS deployment triggered successfully")
EOF
  content_base64 = base64encode(local_file.secrets_rotation_py.content)
  filename      = "${path.module}/secrets_rotation.py"
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