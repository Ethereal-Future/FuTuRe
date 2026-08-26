# Infrastructure — FuTuRe Platform

Terraform configuration for deploying the FuTuRe Stellar Remittance Platform to AWS.

## Architecture

```
Internet
   │
   ▼
[ALB] (public subnets, 3 AZs)
   │
   ▼
[ECS Fargate] (private subnets)
   │        │
   ▼        ▼
[RDS]   [ElastiCache]
Postgres   Redis
```

| Resource       | Service             | Notes                                     |
|----------------|---------------------|-------------------------------------------|
| Network        | VPC + subnets       | 3 AZs, public + private tiers             |
| Compute        | ECS Fargate         | No EC2 to manage; scales per task         |
| Database       | RDS PostgreSQL 16   | Multi-AZ in production, gp3 encrypted     |
| Cache          | ElastiCache Redis 7 | Single node (cluster mode off by default) |
| Load Balancer  | ALB                 | HTTP → HTTPS redirect; `/health` checks   |
| Secrets        | Secrets Manager     | No secrets in Terraform state or source   |

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/downloads) >= 1.7
- AWS credentials with sufficient IAM permissions (see below)
- An S3 bucket and DynamoDB table for remote state (before first `apply`)

## Required IAM Permissions

The CI/CD role used by Terraform needs the following AWS managed policies (or equivalent):

- `AmazonVPCFullAccess`
- `AmazonECS_FullAccess`
- `AmazonRDSFullAccess`
- `AmazonElastiCacheFullAccess`
- `ElasticLoadBalancingFullAccess`
- `SecretsManagerReadWrite`
- `IAMFullAccess` (for task roles)
- `CloudWatchLogsFullAccess`

## First-Time Setup

### 1. Create state storage

```bash
# Create the S3 bucket for Terraform state
aws s3api create-bucket \
  --bucket future-terraform-state \
  --region us-east-1

aws s3api put-bucket-versioning \
  --bucket future-terraform-state \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket future-terraform-state \
  --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# Create the DynamoDB table for state locking
aws dynamodb create-table \
  --table-name future-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### 2. Enable the backend

Uncomment the `backend "s3"` block in `infra/main.tf` and fill in the bucket name.

### 3. Initialize Terraform

```bash
cd infra
terraform init
```

### 4. Populate secrets (before first apply)

The secrets in Secrets Manager are created empty by Terraform. Populate them before the ECS service starts:

```bash
# JWT secret — any strong random string
aws secretsmanager put-secret-value \
  --secret-id future-production/jwt-secret \
  --secret-string "$(openssl rand -hex 32)"

# Stream encryption key — 32-byte hex
aws secretsmanager put-secret-value \
  --secret-id future-production/stream-encryption-key \
  --secret-string "$(openssl rand -hex 32)"

# Backup encryption key — 32-byte hex
aws secretsmanager put-secret-value \
  --secret-id future-production/backup-enc-key \
  --secret-string "$(openssl rand -hex 32)"
```

The RDS master password is managed by AWS (`manage_master_user_password = true`) — no manual step needed.

### 5. Plan and apply

```bash
cd infra

# Review all planned changes (staging)
terraform plan \
  -var-file=environments/staging.tfvars \
  -var="backend_image=ghcr.io/org/future/backend:1.0.0" \
  -var="frontend_image=ghcr.io/org/future/frontend:1.0.0"

# Apply (requires confirmation)
terraform apply \
  -var-file=environments/staging.tfvars \
  -var="backend_image=ghcr.io/org/future/backend:1.0.0" \
  -var="frontend_image=ghcr.io/org/future/frontend:1.0.0"
```

For production, swap in `-var-file=environments/production.tfvars`.

## Deploying a New Version

### Automated Staging Deployment
All pushes to the `main` branch automatically trigger a staging deployment via the [`.github/workflows/deploy-staging.yml`](../.github/workflows/deploy-staging.yml) workflow:
1. Runs all tests
2. Builds new Docker images tagged with the Git SHA
3. Pushes images to GitHub Container Registry (GHCR)
4. Applies Terraform to update the staging ECS cluster
5. Syncs frontend build to S3 + invalidates CloudFront
6. Runs smoke tests against the `/health` endpoint
7. Automatically rolls back to the previous working version if smoke tests fail

### Manual Deployment (Production/Emergency Only)
For production deployments or emergency hotfixes, you can deploy manually:

```bash
cd infra
terraform apply -var-file=environments/production.tfvars -var="backend_image=ghcr.io/org/future/backend:1.2.3"
terraform apply -var="backend_image=ghcr.io/org/future/backend:1.2.3" -var="frontend_image=ghcr.io/org/future/frontend:1.2.3"
```

## Environment Files

Environment-specific sizing lives in `infra/environments/*.tfvars` and is selected with `-var-file` — no secret values are stored in either file; image URIs and credentials are always passed separately via `-var`/CI secrets.

| File                                | Environment  | Key differences                                              |
|--------------------------------------|--------------|----------------------------------------------------------------|
| `environments/staging.tfvars`        | `staging`    | Smaller RDS/Redis instance classes, `backend_desired_count = 1` |
| `environments/production.tfvars`     | `production` | Current production-sized defaults, made explicit               |

`.github/workflows/terraform-plan.yml` selects `environments/production.tfvars` for PRs targeting `main` and `environments/staging.tfvars` otherwise.

ECS performs a rolling deployment with zero downtime when `deployment_minimum_healthy_percent = 100`.

## Autoscaling

The backend ECS service includes automatic application autoscaling that dynamically adjusts the number of running tasks based on load:

- **CPU-based scaling**: Scales out when average CPU utilization exceeds 65% across all tasks
- **Request count scaling**: Scales out when the ALB reports more than 1000 requests per target per minute
- **Cooldown periods**: 60 seconds scale-out cooldown, 300 seconds scale-in cooldown to prevent thrashing
- **Capacity limits**: Minimum of 2 tasks (preserves zero-downtime rolling deployment guarantee), maximum of 10 tasks (configurable via `backend_min_count` and `backend_max_count`)

Container Insights must remain enabled on the ECS cluster for these metrics to be available to the autoscaling policies.

## Secrets Policy

**No secret values are ever stored in Terraform configuration, `.tfvars` files, or source control.**

All runtime secrets (JWT, encryption keys, database credentials) are stored exclusively in AWS Secrets Manager and injected into ECS containers at task startup via the `secrets` container definition field. IAM policies restrict access to only the ECS task execution role.

### Automatic Rotation
All application secrets (JWT signing secret, stream encryption key, backup encryption key) are configured for **automatic rotation every 90 days** via AWS Secrets Manager and a dedicated rotation Lambda function. The rotation process:
1. Generates a new cryptographically secure 32-byte hex secret
2. Validates the new secret is accessible
3. Promotes the new secret to be the current active version
4. Automatically triggers a force-new-deployment of the backend ECS service to pick up the new secret

No manual intervention is required for regular rotation. The rotation Lambda handles the entire workflow with zero downtime, leveraging ECS rolling deployments.

### Manual Rotation (Emergency Only)
To manually rotate a secret (for emergency cases only):
```bash
aws secretsmanager rotate-secret --secret-id future-production/jwt-secret
```
The rotation Lambda will automatically trigger the required ECS deployment to pick up the new value.

## Log Archival

`aws_cloudwatch_log_group.backend` retains logs for only `retention_in_days = 30`. To satisfy longer-term retention needs (incident postmortems, compliance audits, financial recordkeeping), every log event is streamed via a Kinesis Firehose subscription filter into the `aws_s3_bucket.log_archive` bucket (see `infra/log-archival.tf` and the `log_archive_bucket` output).

The archive bucket has versioning and AES-256 server-side encryption enabled, blocks all public access, and applies a lifecycle policy:

| Age                                             | Storage class      |
|--------------------------------------------------|--------------------|
| 0 – `log_archive_glacier_transition_days` (90d)   | S3 Standard         |
| 90d – `log_archive_deep_archive_transition_days` (365d) | Glacier             |
| 365d – `log_archive_expiration_days` (2555d/~7y)  | Glacier Deep Archive |
| > `log_archive_expiration_days`                   | Deleted             |

Objects are written under `ecs-backend-logs/year=YYYY/month=MM/day=DD/` in gzip-compressed batches (Firehose buffers up to 5 MiB or 300 seconds, whichever comes first).

### Retrieving archived logs for an investigation

1. List the day's objects for the incident window:
   ```bash
   aws s3 ls s3://$(terraform output -raw log_archive_bucket)/ecs-backend-logs/year=2026/month=08/day=26/
   ```
2. Download and decompress:
   ```bash
   aws s3 cp s3://$(terraform output -raw log_archive_bucket)/ecs-backend-logs/year=2026/month=08/day=26/ ./logs/ --recursive
   gunzip ./logs/*.gz
   ```
3. Grep/inspect the decompressed JSON log records as needed.

**Follow-up (not required for this issue):** set up AWS Glue/Athena tables over the S3 prefix so archived logs can be queried with SQL instead of downloaded and grepped manually.

## Image Provenance — SBOMs and Signing

Every run of `.github/workflows/docker-scan.yml` generates a CycloneDX SBOM for both the backend and frontend images (uploaded as `sbom-backend-<sha>`/`sbom-frontend-<sha>` workflow artifacts) and, for trusted (non-fork) events, pushes a `scan-<sha>` tagged copy of each image to GHCR and signs it keylessly with [cosign](https://github.com/sigstore/cosign) via GitHub OIDC — no long-lived signing keys are stored as secrets.

Before running `terraform apply` with a given image, verify its signature and inspect its SBOM:

```bash
# Verify the image was signed by this repo's CI (replace with the image digest you intend to deploy)
cosign verify \
  --certificate-identity-regexp "^https://github.com/${GITHUB_REPOSITORY}/.github/workflows/docker-scan.yml@.*" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  ghcr.io/${GITHUB_REPOSITORY}/backend@sha256:<digest>

# Download the corresponding SBOM artifact from the workflow run and inspect components
cat sbom-backend.cyclonedx.json | jq '.components[] | {name, version}'
```

**Follow-up (not required for this issue):** enforce signature verification at ECS deploy time (e.g. via a policy engine or an admission check ahead of `terraform apply`) so unsigned images cannot be deployed at all. Today, signing and SBOM generation are advisory — an operator must run `cosign verify` manually before deploying.

## CI Workflow

The `.github/workflows/terraform-plan.yml` workflow automatically runs `terraform plan` on every pull request that touches files in `infra/`. The plan output is posted as a PR comment for review before merging.

## Variable Reference

| Variable                  | Default           | Description                          |
|---------------------------|-------------------|--------------------------------------|
| `aws_region`              | `us-east-1`       | AWS region                           |
| `environment`             | `production`      | `production` or `staging`            |
| `app_name`                | `future`          | Resource name prefix                 |
| `vpc_cidr`                | `10.0.0.0/16`     | VPC CIDR block                       |
| `availability_zones`      | 3 AZs             | AZs for subnet distribution          |
| `backend_image`           | _(required)_      | Docker image URI for backend         |
| `frontend_image`          | _(required)_      | Docker image URI for frontend        |
| `backend_cpu`             | `512`             | CPU units (512 = 0.5 vCPU)          |
| `backend_memory`          | `1024`            | Memory in MiB                        |
| `backend_desired_count`   | `2`               | Initial number of ECS tasks (autoscaling adjusts this post-deployment) |
| `backend_min_count`       | `2`               | Minimum number of ECS tasks (autoscaling floor, preserves zero-downtime guarantee) |
| `backend_max_count`       | `10`              | Maximum number of ECS tasks (autoscaling ceiling) |
| `db_instance_class`       | `db.t4g.small`    | RDS instance type                    |
| `db_name`                 | `future`          | Database name                        |
| `db_allocated_storage`    | `20`              | Storage in GiB                       |
| `db_backup_retention_days`| `7`               | RDS automated backup retention       |
| `redis_node_type`         | `cache.t4g.small` | ElastiCache node type                |
| `redis_num_cache_nodes`   | `1`               | Number of Redis cache nodes          |
| `log_archive_glacier_transition_days`      | `90`   | Days before archived logs move to Glacier          |
| `log_archive_deep_archive_transition_days` | `365`  | Days before archived logs move to Glacier Deep Archive |
| `log_archive_expiration_days`              | `2555` | Days before archived logs are permanently deleted  |
| `redis_num_cache_nodes`   | `1`               | Number of Redis cache nodes          |
