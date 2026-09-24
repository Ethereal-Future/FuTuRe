# compliance/sanctionsChecker.js: OFAC SDN list updates require manual server redeploy due to absence of automated daily synchronization

**Domain:** Compliance & AML  
**Complexity:** Medium  
**Labels:** `enhancement`, `compliance`, `automation`, `devops`  
**Issue ID:** ISSUE-084

---

## Background
`backend/src/compliance/sanctionsChecker.js` reads sanctions data from a static JSON or CSV file bundled inside the codebase (`backend/data/sanctions.json`).
The US Treasury Office of Foreign Assets Control (OFAC) updates the SDN and Consolidated Sanctions List almost daily.

## Problem
- Newly sanctioned individuals and crypto addresses added to the OFAC list are not checked until a developer manually downloads the new XML/CSV file, commits it to Git, and redeploys the backend.
- The platform operates on days or weeks of stale sanctions data, creating severe legal and regulatory liability under federal sanctions regulations.
- There is no automated synchronization job fetching daily updates from the official OFAC or UN Security Council feeds.

## Proposed Solution
Implement an automated daily sanctions list synchronization worker:
1. Schedule a daily cron job in `backend/src/scheduler.js` at 04:00 UTC.
2. Download the latest official OFAC SDN XML/CSV from `https://www.treasury.gov/ofac/downloads/sdn.xml`.
3. Verify file checksum and parse entities (individuals, vessels, crypto addresses).
4. Upsert entities into a PostgreSQL table `SanctionsEntity` with full-text and trigram search indexes (`pg_trgm`).
5. Invalidate cached sanctions entries in Redis upon successful synchronization.

## Implementation Steps
1. Create Prisma model `SanctionsEntity` with fields `id, name, aliases, entityType, cryptoAddresses, source, updatedAt`.
2. Create `backend/src/compliance/sanctionsSync.js` fetching and parsing OFAC data.
3. Add scheduled task in `scheduler.js`.
4. Update `sanctionsChecker.js` to query `SanctionsEntity` from the database with Redis cache.
5. Add tests verifying XML parsing and database upsert.

## Acceptance Criteria
- [ ] Sanctions list synchronizes automatically every 24 hours.
- [ ] New OFAC designations are active without requiring application redeployment.
- [ ] Crypto addresses associated with sanctioned entities are indexed and screened.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1331](https://github.com/Ethereal-Future/FuTuRe/issues/1331)
