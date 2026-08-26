# ── ECS Application Autoscaling ───────────────────────────────────────────────

# Autoscaling target for the backend ECS service
resource "aws_appautoscaling_target" "backend" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.backend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.backend_min_count
  max_capacity       = var.backend_max_count
}

# CPU utilization-based scaling policy
resource "aws_appautoscaling_policy" "backend_cpu_scaling" {
  name               = "${local.name_prefix}-backend-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.backend.service_namespace
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }

    target_value       = 65.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# Request count per target scaling policy (ALB RequestCountPerTarget)
resource "aws_appautoscaling_policy" "backend_request_scaling" {
  name               = "${local.name_prefix}-backend-request-scaling"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.backend.service_namespace
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb_target_group.backend.arn_suffix}/${aws_lb.main.arn_suffix}"
    }

    target_value       = 1000.0 # Target 1000 requests per target, adjust based on your workload
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}