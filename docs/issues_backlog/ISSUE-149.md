# security/incidentResponse.js: Incident ID generation using `Date.now()` causes collisions under concurrent incident creation

**Domain:** Security & Incident Response  
**Complexity:** Medium  
**Labels:** `bug`, `security`, `concurrency`  
**Issue ID:** ISSUE-149

---

## Background
In `backend/src/security/incidentResponse.js` (lines 66-70):
```javascript
  async createIncident(type, severity, description, affectedSystems = []) {
    const incidentId = `INC-${Date.now()}`;
    const playbook = this.responsePlaybooks.get(type);

    const incident = await prisma.securityIncident.create({
      data: {
        incidentId,
...
```
When automated security detectors (e.g. threatDetector, penetrationTester, compliance alert monitor) detect multiple compromised events simultaneously, they call `createIncident` concurrently within the same millisecond.

## Problem
- `Date.now()` resolution is 1 millisecond.
- In distributed environments or high-throughput batch incident creation, two or more incidents generated in the same millisecond receive identical `incidentId` values (e.g. `INC-1711094400000`).
- Because `incidentId` has a `@unique` constraint in `prisma/schema.prisma`, the second call fails with a database unique constraint violation (`PrismaClientKnownRequestError: P2002`).
- As a result, critical security incidents are dropped and unrecorded during high-volume attacks (such as DDoS or credential stuffing).

## Proposed Solution
1. Replace `Date.now()` with cryptographically secure random suffixes or UUIDv4 / ULID: `INC-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`.
2. Add database-level transaction retry logic in case of rare collision.
3. Ensure automated incident tests verify concurrent incident creations do not clash.

## Implementation Steps
1. Update `incidentId` generation in `backend/src/security/incidentResponse.js` to append cryptographically random bytes.
2. Add a unit test simulating 50 concurrent `createIncident` calls using `Promise.all`.
3. Verify all 50 incidents persist successfully with distinct IDs.

## Acceptance Criteria
- [ ] Concurrent calls to `createIncident` within the same millisecond never throw unique constraint errors.
- [ ] All generated incident IDs follow the format `INC-<timestamp>-<hex>`.
- [ ] Automated test suite passes with 50 concurrent creations.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Impacts incident reporting reliability during active security breaches.

**GitHub Issue:** [1396](https://github.com/Ethereal-Future/FuTuRe/issues/1396)
