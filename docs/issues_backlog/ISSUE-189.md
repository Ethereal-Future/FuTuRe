# infra/ecs.tf: Rigid 1024 MiB task memory causes Fargate OOM crashes during ledger catchup and rehydration

**Domain:** Infra & Capacity  
**Complexity:** Medium  
**Labels:** `bug`, `infra`, `performance`  
**Issue ID:** ISSUE-189

---

## Background
In `infra/ecs.tf` (lines 45-52):
```hcl
resource "aws_ecs_task_definition" "backend" {
  family                   = "${local.name_prefix}-backend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.backend_cpu    # 512
  memory                   = var.backend_memory # 1024
```
Backend tasks are provisioned with 1024 MiB of memory.

## Problem
- When a backend task boots and catches up with the Stellar Horizon streaming ledger or rehydrates the event store with thousands of historical events, Node.js heap memory usage spikes to 1.1 - 1.3 GB.
- AWS Fargate immediately terminates the container with `OutOfMemoryError: Container killed by OOM killer (exit code 137)`.
- The task gets stuck in a continuous crash-loop restart cycle, never completing the event store rehydration!

## Proposed Solution
1. Increase default `backend_memory` to 2048 MiB and `backend_cpu` to 1024 units in `infra/variables.tf`.
2. Configure Node.js memory limit flag `--max-old-space-size=1536` in the container startup command so V8 triggers garbage collection before the Fargate host threshold (2048 MiB) is breached.
3. Stream event replay in chunked batches instead of loading full histories into memory at once.

## Implementation Steps
1. Update `backend_memory` default in `infra/variables.tf` to 2048.
2. Pass `NODE_OPTIONS=--max-old-space-size=1536` in ECS task environment definition.
3. Verify container lifecycle during catchup replay.

## Acceptance Criteria
- [ ] Backend tasks complete full event store rehydration without OOM termination.
- [ ] V8 garbage collection triggers safely within the container memory boundary.
- [ ] ECS service stability metrics show zero exit code 137 events.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Prevents crash loops during container startup and ledger replay.

**GitHub Issue:** [1436](https://github.com/Ethereal-Future/FuTuRe/issues/1436)
