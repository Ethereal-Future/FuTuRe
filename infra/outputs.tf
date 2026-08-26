output "vpc_id" {
  description = "ID of the VPC."
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets."
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "IDs of the private subnets."
  value       = aws_subnet.private[*].id
}

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer."
  value       = aws_lb.main.dns_name
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster."
  value       = aws_ecs_cluster.main.name
}

output "rds_endpoint" {
  description = "Connection endpoint for the RDS PostgreSQL instance."
  value       = aws_db_instance.postgres.endpoint
  sensitive   = true
}

output "redis_primary_endpoint" {
  description = "Primary (read/write) endpoint for the ElastiCache Redis replication group."
  value       = "${aws_elasticache_replication_group.redis.primary_endpoint_address}:${aws_elasticache_replication_group.redis.port}"
  sensitive   = true
}

output "redis_reader_endpoint" {
  description = "Reader endpoint for the ElastiCache Redis replication group (load-balances across replicas)."
  value       = "${aws_elasticache_replication_group.redis.reader_endpoint_address}:${aws_elasticache_replication_group.redis.port}"
  sensitive   = true
}

output "jwt_secret_arn" {
  description = "ARN of the JWT secret in Secrets Manager."
  value       = aws_secretsmanager_secret.jwt_secret.arn
}
