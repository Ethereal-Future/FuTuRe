import boto3
import json
import logging
import os
import secrets
import string
from typing import Any, Dict, Optional

logger = logging.getLogger()
logger.setLevel(logging.INFO)

secrets_manager = boto3.client('secretsmanager')
ecs = boto3.client('ecs')
rds = boto3.client('rds')

DB_SECRET_REQUIRED_KEYS = {'engine', 'host', 'username', 'password', 'dbname', 'port'}
DB_PASSWORD_LENGTH = 32
DB_PASSWORD_ALPHABET = string.ascii_letters + string.digits + '!#$%^&*()-_=+[]{}<>?'

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
    """Step 1: Generate a new secret and stage it as AWSPENDING.

    Database secrets are JSON objects ({"engine", "host", "username",
    "password", "dbname", "port", ...}); only the password is replaced so the
    backend can still JSON.parse the rotated value. Plain secrets (JWT, stream
    and backup encryption keys) keep their 32-byte hex format.
    """
    metadata = secrets_manager.describe_secret(SecretId=secret_id)
    if 'AWSPENDING' not in metadata.get('VersionIdsToStages', {}).get(token, []):
        logger.info(f"Version {token} of {secret_id} is not AWSPENDING, skipping create")
        return

    # Idempotency: a previous invocation may already have stored the value
    try:
        secrets_manager.get_secret_value(SecretId=secret_id, VersionId=token, VersionStage='AWSPENDING')
        logger.info(f"Pending secret already exists for {secret_id}, skipping create")
        return
    except secrets_manager.exceptions.ResourceNotFoundException:
        pass

    current = secrets_manager.get_secret_value(SecretId=secret_id, VersionStage='AWSCURRENT')
    new_secret = build_rotated_secret(current['SecretString'])

    secrets_manager.put_secret_value(
        SecretId=secret_id,
        ClientRequestToken=token,
        SecretString=new_secret,
        VersionStages=['AWSPENDING']
    )
    logger.info(f"Created new pending secret for {secret_id}")

def build_rotated_secret(current_secret_string: str) -> str:
    """Return the new secret string, preserving JSON structure when present."""
    current_dict = _parse_db_secret(current_secret_string)
    if current_dict is None:
        return secrets.token_hex(32)

    current_dict['password'] = _generate_db_password()
    return json.dumps(current_dict)

def set_secret(secret_id: str, token: str) -> None:
    """Step 2: Apply the pending credentials to the database (DB secrets only)."""
    pending = secrets_manager.get_secret_value(SecretId=secret_id, VersionId=token, VersionStage='AWSPENDING')
    pending_dict = _parse_db_secret(pending['SecretString'])
    if pending_dict is None:
        logger.info(f"{secret_id} is not a database secret, nothing to set")
        return

    db_instance_id = pending_dict.get('dbInstanceIdentifier') or os.environ.get('DB_INSTANCE_IDENTIFIER')
    if not db_instance_id:
        raise ValueError(f"No dbInstanceIdentifier in secret or DB_INSTANCE_IDENTIFIER env for {secret_id}")

    rds.modify_db_instance(
        DBInstanceIdentifier=db_instance_id,
        MasterUserPassword=pending_dict['password'],
        ApplyImmediately=True
    )
    logger.info(f"Applied pending password to RDS instance {db_instance_id}")

def test_secret(secret_id: str, token: str) -> None:
    """Step 3: Verify the pending secret is retrievable and well-formed."""
    pending = secrets_manager.get_secret_value(SecretId=secret_id, VersionId=token, VersionStage='AWSPENDING')
    secret_string = pending['SecretString']

    if secret_string.lstrip().startswith('{'):
        # Raises if the JSON is malformed or required fields went missing
        if _parse_db_secret(secret_string) is None:
            raise ValueError(f"Pending secret for {secret_id} is JSON but missing required DB fields")
    elif not secret_string:
        raise ValueError(f"Pending secret for {secret_id} is empty")

    logger.info(f"Test passed for {secret_id}")

def finish_secret(secret_id: str, token: str) -> None:
    """Step 4: Promote the pending version to AWSCURRENT and redeploy."""
    metadata = secrets_manager.describe_secret(SecretId=secret_id)
    current_version = None
    for version, stages in metadata['VersionIdsToStages'].items():
        if 'AWSCURRENT' in stages:
            current_version = version
            break

    if current_version == token:
        logger.info(f"Version {token} already AWSCURRENT for {secret_id}")
        return

    # Move AWSCURRENT to the new version; the old one becomes AWSPREVIOUS
    secrets_manager.update_secret_version_stage(
        SecretId=secret_id,
        VersionStage='AWSCURRENT',
        RemoveFromVersionId=current_version,
        MoveToVersionId=token
    )
    logger.info(f"Set new secret as current for {secret_id}")

    # Trigger ECS deployment to pick up the new secret
    _trigger_ecs_deployment()

def _parse_db_secret(secret_string: str) -> Optional[Dict[str, Any]]:
    """Parse a JSON database secret; return None for plain (non-JSON) secrets."""
    try:
        parsed = json.loads(secret_string)
    except (TypeError, ValueError):
        return None
    if not isinstance(parsed, dict):
        return None

    missing = DB_SECRET_REQUIRED_KEYS - parsed.keys()
    if missing:
        raise ValueError(f"Database secret is missing required keys: {sorted(missing)}")
    return parsed

def _generate_db_password() -> str:
    # RDS master passwords may not contain '/', '"', '@' or spaces
    return ''.join(secrets.choice(DB_PASSWORD_ALPHABET) for _ in range(DB_PASSWORD_LENGTH))

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