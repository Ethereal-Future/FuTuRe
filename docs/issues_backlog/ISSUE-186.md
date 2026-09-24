# infra/rds.tf: RDS enhanced monitoring enabled without `monitoring_role_arn` causes `terraform apply` failure

**Domain:** Infra & Terraform  
**Complexity:** Medium  
**Labels:** `bug`, `infra`, `terraform`  
**Issue ID:** ISSUE-186

---

## Background
In `infra/rds.tf` (lines 33-35):
```hcl
  performance_insights_enabled = true
  monitoring_interval          = 60

  tags = { Name = "${local.name_prefix}-postgres" }
```
`monitoring_interval = 60` enables AWS RDS Enhanced Monitoring.

## Problem
- In AWS RDS, setting `monitoring_interval > 0` requires a valid IAM role ARN specified in `monitoring_role_arn`.
- Without `monitoring_role_arn`, running `terraform apply` fails with AWS API error:
  `InvalidParameterValue: MonitoringInterval was specified without MonitoringRoleArn`.
- This completely halts infrastructure provisioning in CI/CD pipelines.

## Proposed Solution
1. Define an IAM role `aws_iam_role.rds_monitoring` with assume-role policy for `monitoring.rds.amazonaws.com`.
2. Attach the AWS-managed policy `arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole`.
3. Reference the role ARN in `aws_db_instance.postgres`:
```hcl
  monitoring_interval = 60
  monitoring_role_arn = aws_iam_role.rds_monitoring.arn
```

## Implementation Steps
1. Add IAM role and policy attachment for RDS enhanced monitoring in `infra/rds.tf`.
2. Set `monitoring_role_arn = aws_iam_role.rds_monitoring.arn` on `aws_db_instance.postgres`.
3. Run `terraform validate` to verify schema validity.

## Acceptance Criteria
- [ ] `terraform validate` passes without errors.
- [ ] RDS instance has valid IAM role attached for enhanced monitoring.
- [ ] Metrics are successfully delivered to CloudWatch Logs.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Fixes terraform pipeline provisioning failure.

**GitHub Issue:** [1433](https://github.com/Ethereal-Future/FuTuRe/issues/1433)
