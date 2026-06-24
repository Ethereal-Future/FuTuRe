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

# Review all planned changes
terraform plan \
  -var="backend_image=ghcr.io/org/future/backend:1.0.0" \
  -var="frontend_image=ghcr.io/org/future/frontend:1.0.0"

# Apply (requires confirmation)
terraform apply \
  -var="backend_image=ghcr.io/org/future/backend:1.0.0" \
  -var="frontend_image=ghcr.io/org/future/frontend:1.0.0"
```

## Deploying a New Version

Update the Docker image tag in your CI/CD pipeline or apply directly:

```bash
cd infra
terraform apply -var="backend_image=ghcr.io/org/future/backend:1.2.3"
```

ECS performs a rolling deployment with zero downtime when `deployment_minimum_healthy_percent = 100`.

## Secrets Policy

**No secret values are ever stored in Terraform configuration, `.tfvars` files, or source control.**

All runtime secrets (JWT, encryption keys, database credentials) are stored exclusively in AWS Secrets Manager and injected into ECS containers at task startup via the `secrets` container definition field. IAM policies restrict access to only the ECS task execution role.

To rotate a secret:

```bash
aws secretsmanager rotate-secret --secret-id future-production/jwt-secret
# Then force a new ECS deployment to pick up the new value:
aws ecs update-service \
  --cluster future-production-cluster \
  --service future-production-backend \
  --force-new-deployment
```

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
| `backend_desired_count`   | `2`               | Number of ECS tasks                  |
| `db_instance_class`       | `db.t4g.small`    | RDS instance type                    |
| `db_name`                 | `future`          | Database name                        |
| `db_allocated_storage`    | `20`              | Storage in GiB                       |
| `db_backup_retention_days`| `7`               | RDS automated backup retention       |
| `redis_node_type`         | `cache.t4g.small` | ElastiCache node type                |
| `redis_num_cache_nodes`   | `1`               | Number of Redis cache nodes          |
