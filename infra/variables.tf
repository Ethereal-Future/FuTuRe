variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (production, staging)."
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "staging"], var.environment)
    error_message = "environment must be 'production' or 'staging'."
  }
}

variable "app_name" {
  description = "Short application name used as a prefix for resource names."
  type        = string
  default     = "future"
}

# ── Networking ────────────────────────────────────────────────────────────────

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones to use."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

# ── ECS ───────────────────────────────────────────────────────────────────────

variable "backend_image" {
  description = "Full Docker image URI for the backend service (e.g. ghcr.io/org/repo/backend:1.2.3)."
  type        = string
}

variable "frontend_bucket_name" {
  description = "Name for the S3 bucket hosting the frontend static assets."
  type        = string
  default     = "future-app-frontend"
}

variable "backend_cpu" {
  description = "CPU units for the backend Fargate task (1 vCPU = 1024)."
  type        = number
  default     = 512
}

variable "backend_memory" {
  description = "Memory in MiB for the backend Fargate task."
  type        = number
  default     = 1024
}

variable "backend_desired_count" {
  description = "Initial desired number of backend ECS tasks (autoscaling will adjust this post-deployment)."
  type        = number
  default     = 2
}

variable "backend_min_count" {
  description = "Minimum number of backend ECS tasks (autoscaling minimum capacity)."
  type        = number
  default     = 2
}

variable "backend_max_count" {
  description = "Maximum number of backend ECS tasks (autoscaling maximum capacity)."
  type        = number
  default     = 10
}

# ── RDS ───────────────────────────────────────────────────────────────────────

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.small"
}

variable "db_name" {
  description = "Name of the PostgreSQL database."
  type        = string
  default     = "future"
}

variable "db_username" {
  description = "Master username for the RDS instance."
  type        = string
  default     = "future_admin"
  sensitive   = true
}

variable "db_allocated_storage" {
  description = "Allocated storage in GiB."
  type        = number
  default     = 20
}

variable "db_backup_retention_days" {
  description = "Number of days to retain automated RDS backups."
  type        = number
  default     = 7
}

# ── ElastiCache ───────────────────────────────────────────────────────────────

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.small"
}

variable "redis_num_cache_nodes" {
  description = "Number of cache clusters (primary + replicas) in the Redis replication group. Must be >= 2 for Multi-AZ automatic failover."
  type        = number
  default     = 1
}
  default     = 2
}

# ── Log Archival ──────────────────────────────────────────────────────────────

variable "log_archive_glacier_transition_days" {
  description = "Days after object creation before archived logs transition to Glacier."
  type        = number
  default     = 90
}

variable "log_archive_deep_archive_transition_days" {
  description = "Days after object creation before archived logs transition to Glacier Deep Archive."
  type        = number
  default     = 365
}

variable "log_archive_expiration_days" {
  description = "Days after object creation before archived logs are permanently deleted."
  type        = number
  default     = 2555 # ~7 years, matching typical financial recordkeeping requirements
}
}

# ── Email (SES / DKIM) ────────────────────────────────────────────────────────

variable "email_domain" {
  description = "Transactional sending domain verified in SES (e.g. futureremit.app). Leave empty to skip SES/DNS provisioning."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID for email_domain, where DKIM/SPF/DMARC records are published."
  type        = string
  default     = ""
}

variable "email_mail_from_subdomain" {
  description = "Subdomain of email_domain used as the SES custom MAIL FROM (envelope sender) domain."
  type        = string
  default     = "mail"
}

variable "dkim_key_selector" {
  description = "DKIM selector for app-level signing via a non-SES SMTP relay. When set, a dkim-private-key secret is created and DKIM_* env vars are passed to the backend. Leave empty when sending through SES (Easy DKIM)."
  type        = string
  default     = ""
}

variable "dmarc_policy" {
  description = "DMARC policy for email_domain. Start with 'none' or 'quarantine' while monitoring, then move to 'reject'."
  type        = string
  default     = "reject"

  validation {
    condition     = contains(["none", "quarantine", "reject"], var.dmarc_policy)
    error_message = "dmarc_policy must be 'none', 'quarantine' or 'reject'."
  }
}

variable "dmarc_report_email" {
  description = "Mailbox that receives DMARC aggregate (rua) reports. Leave empty to omit."
  type        = string
  default     = ""
}

# ── SMS ───────────────────────────────────────────────────────────────────────

variable "sms_sns_failover_enabled" {
  description = "Use AWS SNS as the secondary SMS carrier when Twilio fails. Grants the ECS task sns:Publish and sets SMS_FAILOVER_PROVIDER=sns."
  type        = bool
  default     = false
}
