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

variable "frontend_image" {
  description = "Full Docker image URI for the frontend service."
  type        = string
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
  description = "Desired number of backend ECS tasks."
  type        = number
  default     = 2
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
  description = "Number of cache nodes in the cluster."
  type        = number
  default     = 1
}
