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

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id  = "${local.name_prefix}-redis"
  description           = "Redis replication group for ${local.name_prefix} (balance/rate caching, rate limiting)."
  engine                = "redis"
  engine_version        = "7.1"
  node_type             = var.redis_node_type
  num_cache_clusters    = var.redis_num_cache_nodes
  parameter_group_name  = "default.redis7"
  port                  = 6379

  automatic_failover_enabled = true
  multi_az_enabled           = true

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  snapshot_retention_limit = 7
  snapshot_window          = "05:00-06:00"

  tags = { Name = "${local.name_prefix}-redis" }
}
