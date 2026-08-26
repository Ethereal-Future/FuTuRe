output "frontend_url" {
  description = "URL of the deployed frontend application."
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}