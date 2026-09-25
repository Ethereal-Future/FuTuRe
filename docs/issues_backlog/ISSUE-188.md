# infra/secrets-rotation.tf: Rotation Lambda missing VPC configuration cannot reach private RDS instance

**Domain:** Infra & Networking  
**Complexity:** Hard  
**Labels:** `bug`, `infra`, `terraform`, `network`  
**Issue ID:** ISSUE-188

---

## Background
In `infra/secrets-rotation.tf`:
The secret rotation Lambda function `aws_lambda_function.secrets_rotation` is defined without a `vpc_config` block, placing it in the default AWS public Lambda network.
Meanwhile, the RDS PostgreSQL instance in `infra/rds.tf` is deployed in private subnets without public accessibility (`publicly_accessible = false`).

## Problem
- In the `test-secret` phase of rotation, the Lambda must open a PostgreSQL connection to the database to verify the newly staged password before activating it.
- Because the Lambda is not attached to the VPC private subnets and security group, it cannot route traffic to the private IP of RDS.
- Connection attempts time out after 15 minutes, the rotation fails with `ClientError: Task timed out`, and the secret gets stuck in a perpetual `AWSPENDING` state, blocking all future rotations!

## Proposed Solution
1. Configure `vpc_config` on `aws_lambda_function.secrets_rotation`:
```hcl
  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda_rotation.id]
  }
```
2. Ensure the Lambda security group allows egress on port 5432 to `aws_security_group.rds`.
3. Provision an AWS Secrets Manager VPC Endpoint (`com.amazonaws.<region>.secretsmanager`) so the VPC-attached Lambda can reach the Secrets Manager API without public internet routing.

## Implementation Steps
1. Add `vpc_config` to `aws_lambda_function.secrets_rotation` in `infra/secrets-rotation.tf`.
2. Create `aws_security_group.lambda_rotation` and grant RDS access.
3. Add VPC Endpoint for Secrets Manager.
4. Verify Terraform plan and apply.

## Acceptance Criteria
- [ ] Rotation Lambda can establish TCP connections to private RDS on port 5432.
- [ ] Rotation Lambda can communicate with Secrets Manager via VPC endpoint.
- [ ] Rotations execute and pass `test-secret` successfully within the VPC.

## Notes
- **Complexity Rating:** Hard
- **Subsystem Notes:** Prerequisite for functional automated database rotation in private VPCs.

**GitHub Issue:** [1435](https://github.com/Ethereal-Future/FuTuRe/issues/1435)
