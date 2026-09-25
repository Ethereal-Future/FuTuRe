# eventSourcing/eventArchiver.js: Cold event archival to S3 does not verify archive checksums before truncating hot database records

**Domain:** Event Sourcing & Projections  
**Complexity:** Hard  
**Labels:** `bug`, `backend`, `database`, `data-pipeline`  
**Issue ID:** ISSUE-114

---

## Background
In `backend/src/eventSourcing/eventArchiver.js`, `archiveEvents` queries events older than retention cutoff (e.g. 90 days), uploads a compressed JSON/gzip archive to AWS S3, and deletes the archived rows from `prisma.eventStore`.

## Problem
- The archiver issues an S3 `PutObject` command, but does not verify the S3 ETag / MD5 checksum or download and verify the uploaded archive before executing `prisma.eventStore.deleteMany(...)`.
- If S3 upload is truncated due to a transient network drop or multipart upload failure:
  - The script executes deletion of the hot database rows.
  - Irreplaceable historical financial transaction events are permanently destroyed with zero recovery capability!
- Data loss in an event-sourced architecture is catastrophic, as the event log is the ultimate source of truth.

## Proposed Solution
Implement a strict multi-step verification protocol before pruning:
1. Compute the SHA-256 checksum of the local archive buffer before uploading.
2. Upload archive to S3 with `Content-MD5` or SHA-256 checksum header.
3. Read the uploaded object back from S3 or issue a `HeadObject` request to verify checksum matches.
4. Verify that the number of serialized records in the S3 file exactly equals `archivedCount`.
5. Only execute `deleteMany` in PostgreSQL once cryptographic verification succeeds.

## Implementation Steps
1. Compute SHA-256 hash of archive data in `eventArchiver.js`.
2. Upload to S3 and verify checksum via AWS SDK `HeadObject`.
3. Count records in archive vs database query result.
4. Wrap deletion in a database transaction.
5. Add tests asserting deletion is aborted if checksum validation fails.

## Acceptance Criteria
- [ ] Database rows are deleted only after cryptographic verification of S3 archive.
- [ ] Corrupted or truncated uploads abort deletion automatically.
- [ ] Event log durability is mathematically guaranteed.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1361](https://github.com/Ethereal-Future/FuTuRe/issues/1361)
