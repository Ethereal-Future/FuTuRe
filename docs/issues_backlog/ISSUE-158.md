# security/penetrationTester.js: Pen test results written to local filesystem `data/pentests/` are lost in ephemeral containers

**Domain:** Security & Tooling  
**Complexity:** Medium  
**Labels:** `bug`, `infra`, `storage`  
**Issue ID:** ISSUE-158

---

## Background
In `backend/src/security/penetrationTester.js` (lines 8-9, 100-108):
```javascript
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PENTEST_DIR = path.join(__dirname, '../../data/pentests');
```
Audit and penetration test artifacts are written to a local disk directory via `fs.writeFile`.

## Problem
- AWS Fargate tasks and Kubernetes pods run with ephemeral container filesystems.
- Whenever security scans run on a background worker or ECS task:
  1. The results are saved locally in the container's overlay filesystem.
  2. When the container terminates or scales down, all security reports, vulnerability discoveries, and audit evidence are permanently destroyed.
  3. Other nodes cannot access past pentest results when querying `/api/security/pentest/history`.

## Proposed Solution
1. Persist penetration test results in the PostgreSQL database under a `SecurityScanResult` model.
2. For large payloads or full execution logs, upload reports to an S3 bucket configured for compliance/audit storage.
3. Deprecate local filesystem writes in `penetrationTester.js`.

## Implementation Steps
1. Create `SecurityScanResult` Prisma model in `prisma/schema.prisma`.
2. Migrate `saveResults` in `backend/src/security/penetrationTester.js` from `fs.writeFile` to Prisma / S3.
3. Update retrieval endpoints to query the database.

## Acceptance Criteria
- [ ] Penetration test results persist across container recycles.
- [ ] All cluster nodes can view historical scan results.
- [ ] No reliance on local filesystem paths in production.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Essential for SOC 2 and compliance audit trails.

**GitHub Issue:** [1405](https://github.com/Ethereal-Future/FuTuRe/issues/1405)
