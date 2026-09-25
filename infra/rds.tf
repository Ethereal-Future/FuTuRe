# ── RDS Subnet Group ─────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "main" {
  name        = "${local.name_prefix}-db-subnet-group"
  description = "Private subnets for the RDS PostgreSQL instance."
  subnet_ids  = aws_subnet.private[*].id
}

# ── RDS Parameter Group ──────────────────────────────────────────────────────
# Enforce a server-wide default statement_timeout so runaway queries are
# cancelled even when a connection (e.g. via PgBouncer transaction pooling)
# does not carry the client-side startup option.

resource "aws_db_parameter_group" "postgres" {
  name        = "${local.name_prefix}-postgres16"
  family      = "postgres16"
  description = "FuTuRe PostgreSQL parameters (statement_timeout enforcement)."

  parameter {
    name         = "statement_timeout"
    value        = "5000"
    apply_method = "immediate"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ── RDS PostgreSQL ────────────────────────────────────────────────────────────

resource "aws_db_instance" "postgres" {
  identifier        = "${local.name_prefix}-postgres"
  engine            = "postgres"
  engine_version    = "16"
  instance_class    = var.db_instance_class
  allocated_storage = var.db_allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = var.db_name
  username = var.db_username
  # Password is read from AWS Secrets Manager at application startup.
  # Set manage_master_user_password = true to let RDS manage rotation.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  parameter_group_name   = aws_db_parameter_group.postgres.name

  backup_retention_period = var.db_backup_retention_days
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:00-sun:05:00"

  multi_az               = var.environment == "production"
  deletion_protection    = var.environment == "production"
  skip_final_snapshot    = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "${local.name_prefix}-final-snapshot" : null

  performance_insights_enabled = true
  monitoring_interval          = 60

  tags = { Name = "${local.name_prefix}-postgres" }
}
