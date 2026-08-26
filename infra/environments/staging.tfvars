# Staging environment sizing.
# Image URIs and any credentials are NOT set here — pass them via
# -var/CI secrets at plan/apply time, e.g.:
#   terraform plan -var-file=environments/staging.tfvars \
#     -var="backend_image=..." -var="frontend_image=..."

environment = "staging"

# ── ECS ───────────────────────────────────────────────────────────────────────
backend_cpu           = 256
backend_memory        = 512
backend_desired_count = 1

# ── RDS ───────────────────────────────────────────────────────────────────────
db_instance_class        = "db.t4g.micro"
db_allocated_storage      = 20
db_backup_retention_days = 3

# ── ElastiCache ───────────────────────────────────────────────────────────────
redis_node_type       = "cache.t4g.micro"
redis_num_cache_nodes = 1
