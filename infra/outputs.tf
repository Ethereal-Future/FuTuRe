output "frontend_url" {
  description = "URL of the deployed frontend application."
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}
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

output "redis_auth_token_arn" {
  description = "ARN of the Redis AUTH token in Secrets Manager."
  value       = aws_secretsmanager_secret.redis_auth_token.arn
}

output "log_archive_bucket" {
  description = "Name of the S3 bucket archiving ECS backend logs long-term."
  value       = aws_s3_bucket.log_archive.bucket
}
