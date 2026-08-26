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
| Cache          | ElastiCache Redis 7 | Replication group, Multi-AZ automatic failover |
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

### 5. Plan and apply (first-time bootstrap only)

Before the CI-driven apply workflow (below) can run, the S3 backend from step 1-2 must exist and this first apply must create the baseline resources:

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

### Automated (primary path)

`.github/workflows/terraform-apply.yml` runs on every push to `main` that touches `infra/**`:

1. A `plan` job assumes the `AWS_TERRAFORM_APPLY_ROLE_ARN` role via OIDC, resolves `backend_image`/`frontend_image` from the current release version in `.release-please-manifest.json` (the same images `release.yml` builds and pushes to `ghcr.io`), and runs `terraform plan`. The plan is posted to the job summary and, when the change came in via a PR, as a comment on that PR.
2. An `apply` job then waits for manual approval on the `production` GitHub Environment before running `terraform apply` against the exact plan from step 1.

**One-time setup required** (repo admin): create a `production` environment under **Settings → Environments** with required reviewers configured, and add the `AWS_TERRAFORM_APPLY_ROLE_ARN` secret (an IAM role scoped to `terraform apply` permissions, separate from the read-only `AWS_TERRAFORM_PLAN_ROLE_ARN` used by `terraform-plan.yml`). Without this, the `apply` job will fail to authenticate or will apply without an approval gate.

### Manual (fallback only)

If the automated workflow is unavailable, apply directly — this bypasses the approval gate and CI-verified image tags, so use it only when necessary and coordinate with the team first:
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

## Redis Multi-AZ Cutover Runbook

`infra/elasticache.tf` provisions Redis as an `aws_elasticache_replication_group`
with `automatic_failover_enabled = true` and `multi_az_enabled = true`. This
resource type replaced the earlier single-node `aws_elasticache_cluster`, which
does not support Multi-AZ failover. Redis backs balance/exchange-rate caching
and rate limiting, so plan the cutover as a maintenance-window operation:

1. **Review the plan carefully.** Terraform cannot upgrade an
   `aws_elasticache_cluster` in place to an `aws_elasticache_replication_group`
   — `terraform plan` will show the old cluster being destroyed and a new
   replication group being created. Confirm this is expected before applying.
2. **Schedule a maintenance window.** The cutover causes a Redis data-plane
   outage (cache clear + reconnect); the application must tolerate a cold
   cache (rate-limit counters reset, cached balances/rates re-fetch). Announce
   the window and expect a brief spike in origin/backend load as caches
   repopulate.
3. **Apply.** Run `terraform apply` (via `terraform-apply.yml` or manually per
   above). The old cluster is destroyed and the new replication group created;
   `redis_primary_endpoint` and `redis_reader_endpoint` (see Outputs below)
   will have new values.
4. **Update the backend's `REDIS_URL`** (or equivalent secret/config) to point
   at the new `redis_primary_endpoint`, then force a new ECS deployment:
   ```bash
   aws ecs update-service \
     --cluster future-production-cluster \
     --service future-production-backend \
     --force-new-deployment
   ```
5. **Verify failover.** In staging, trigger a manual failover
   (`aws elasticache test-failover --replication-group-id future-staging-redis
   --node-group-id <shard-id>`) and confirm the application reconnects with
   minimal downtime before relying on this in production.
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

Once a PR merges to `main`, `.github/workflows/terraform-apply.yml` plans and — after manual approval on the `production` environment — applies the same change. See "Deploying a New Version" above.

### Static Analysis (tfsec)

The same workflow also runs [tfsec](https://aquasecurity.github.io/tfsec/) against `infra/` on every PR. Findings are posted as a PR comment, and the job **fails on any HIGH or CRITICAL finding** — MEDIUM/LOW findings are reported but do not block the merge.

To add a suppression for a finding you've determined is a justified, by-design exception (not a bug to fix):

1. Identify the rule's long ID from the tfsec output or PR comment (e.g. `aws-ec2-no-public-ingress-sgr`).
2. Add it to the `exclude` list in `.tfsec.yml` at the repo root, with a comment directly above it explaining:
   - **why** the finding doesn't apply or is an accepted risk,
   - the **date** of the decision, and
   - a **tracking issue**, if the underlying risk should eventually be addressed.
3. Get the suppression approved in code review — a suppression is a security decision, not just a CI workaround.

Prefer fixing the underlying misconfiguration over suppressing it whenever the fix is safe and low-risk (e.g. enabling encryption, dropping invalid headers). Only suppress findings that reflect an intentional architectural choice (e.g. a public-facing load balancer) or that require a larger, separately-tracked change.

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
| `redis_num_cache_nodes`   | `2`               | Cache clusters (primary + replicas) in the Redis replication group; must be >= 2 for Multi-AZ failover |
| `redis_num_cache_nodes`   | `1`               | Number of Redis cache nodes          |
| `log_archive_glacier_transition_days`      | `90`   | Days before archived logs move to Glacier          |
| `log_archive_deep_archive_transition_days` | `365`  | Days before archived logs move to Glacier Deep Archive |
| `log_archive_expiration_days`              | `2555` | Days before archived logs are permanently deleted  |
| `redis_num_cache_nodes`   | `1`               | Number of Redis cache nodes          |
