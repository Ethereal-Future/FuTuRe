# ── ElastiCache Subnet Group ──────────────────────────────────────────────────

resource "aws_elasticache_subnet_group" "main" {
  name        = "${local.name_prefix}-redis-subnet-group"
  description = "Private subnets for the ElastiCache Redis cluster."
  subnet_ids  = aws_subnet.private[*].id
}

# ── ElastiCache Redis ─────────────────────────────────────────────────────────
#
# aws_elasticache_replication_group (not the legacy aws_elasticache_cluster)
# so we can enable Multi-AZ automatic failover: Redis backs balance/exchange-
# rate caching and rate limiting, so a single-node outage previously meant a
# full cache (and rate-limiter) outage with no failover.
#
# AWS rejects Multi-AZ / automatic failover on a single-node group, so both
# are derived from redis_num_cache_nodes: with >= 2 nodes (the default, and
# what staging/production set) replicas are spread across the private-subnet
# AZs and a replica is promoted automatically on primary failure.

locals {
  redis_ha_enabled = var.redis_num_cache_nodes >= 2
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id  = "${local.name_prefix}-redis"
  description           = "Redis replication group for ${local.name_prefix} (balance/rate caching, rate limiting)."
  engine                = "redis"
  engine_version        = "7.1"
  node_type             = var.redis_node_type
  num_cache_clusters    = var.redis_num_cache_nodes
  parameter_group_name  = "default.redis7"
  port                  = 6379

  automatic_failover_enabled = local.redis_ha_enabled
  multi_az_enabled           = local.redis_ha_enabled
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  # AUTH requires transit encryption. Token is generated in Terraform and
  # stored in Secrets Manager (see infra/secrets.tf) — never hardcoded.
  auth_token                 = random_password.redis_auth.result
  auth_token_update_strategy = "SET"

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  snapshot_retention_limit = 7
  snapshot_window          = "05:00-06:00"

  tags = { Name = "${local.name_prefix}-redis" }
}
