# Production environment sizing — makes the current defaults explicit.
# Image URIs and any credentials are NOT set here — pass them via
# -var/CI secrets at plan/apply time, e.g.:
#   terraform plan -var-file=environments/production.tfvars \
#     -var="backend_image=..." -var="frontend_image=..."

environment = "production"

# ── ECS ───────────────────────────────────────────────────────────────────────
backend_cpu           = 512
backend_memory        = 1024
backend_desired_count = 2

# ── RDS ───────────────────────────────────────────────────────────────────────
db_instance_class        = "db.t4g.small"
db_allocated_storage      = 20
db_backup_retention_days = 7

# ── ElastiCache ───────────────────────────────────────────────────────────────
redis_node_type       = "cache.t4g.small"
redis_num_cache_nodes = 1
