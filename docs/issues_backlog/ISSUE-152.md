# security/ipWhitelist.js: CIDR subnet whitelisting is broken due to strict string lookup in cache Map

**Domain:** Security & Network  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `network`  
**Issue ID:** ISSUE-152

---

## Background
In `backend/src/security/ipWhitelist.js`:
The file supports CIDR format validation (`isValidCIDR`, `10.0.0.0/16`), allowing administrators to whitelist CIDR subnets.
However, in `isWhitelisted(ip)` (lines 78-81):
```javascript
function isWhitelisted(ip) {
  if (!ip) return false;
  return whitelistedIPsCache.has(ip);
}
```
The lookup only performs an exact string match against keys in `whitelistedIPsCache`.

## Problem
- When an admin whitelists a subnet like `192.168.1.0/24` or `10.0.0.0/8`, the key in `whitelistedIPsCache` is `'192.168.1.0/24'`.
- When a client sends a request from `192.168.1.45`, `isWhitelisted('192.168.1.45')` checks `whitelistedIPsCache.has('192.168.1.45')`, which evaluates to `false`!
- Subnet whitelisting never matches any client IP address! Legitimate automated systems, payment gateways, and admin networks within whitelisted subnets get blocked or rate limited.

## Proposed Solution
1. Parse stored CIDR ranges into IP range objects (binary or BigInt network and mask).
2. In `isWhitelisted(ip)`, first check exact IP matches in O(1) with `Set.has(ip)`.
3. If not found in exact IPs, iterate over active CIDR ranges and test whether the incoming IP falls within the subnet bitmask using a robust IP matching library or native bitwise arithmetic supporting both IPv4 and IPv6.

## Implementation Steps
1. Separate `whitelistedIPsCache` into `exactIPs` (Set) and `cidrSubnets` (Array of parsed CIDRs).
2. Implement subnet containment checking for IPv4 and IPv6.
3. Add comprehensive unit tests for IPv4 CIDRs (e.g. `/24`, `/16`), IPv6 CIDRs (e.g. `/64`), and boundary IPs.

## Acceptance Criteria
- [ ] Clients with IPs inside whitelisted CIDR subnets are correctly identified as whitelisted.
- [ ] Clients outside whitelisted CIDR subnets are rejected.
- [ ] Both IPv4 and IPv6 subnets are supported accurately.

## Notes
- **Complexity Rating:** Hard
- **Subsystem Notes:** Essential for office and VPC subnet whitelisting.

**GitHub Issue:** [1399](https://github.com/Ethereal-Future/FuTuRe/issues/1399)
