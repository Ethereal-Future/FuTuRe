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