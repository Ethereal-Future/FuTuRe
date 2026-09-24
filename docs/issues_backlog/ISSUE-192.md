# scripts/pii-scan.mjs: Regex matches image asset suffixes (`@2x.png`, `@3x.png`) as email addresses, breaking CI

**Domain:** CI/CD & Pre-commit  
**Complexity:** Medium  
**Labels:** `bug`, `ci-cd`, `regex`  
**Issue ID:** ISSUE-192

---

## Background
In `scripts/pii-scan.mjs` (lines 19-21):
```javascript
const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
```
The script scans tracked source files for secrets and leaked PII email addresses before allowing commits or pull request merges.

## Problem
- When retina display asset references like `logo@2x.png` or `avatar@3x.png` are referenced in CSS, JSX, or JSON manifest files, `EMAIL_REGEX` matches `logo@2x.png` (matching `logo`, `@2x`, and `.png`).
- Since `2x.png` is not in `ALLOWED_EMAIL_DOMAINS` (`example.com`, `example.org`, etc.), `node scripts/pii-scan.mjs` flags a PII violation and exits with code 1.
- Developers are blocked from adding standard resolution-scaled images to the frontend.

## Proposed Solution
1. Refine the email regex to require standard valid TLDs or exclude image file extensions (`.png`, `.jpg`, `.svg`, `.webp`).
2. Add a negative lookahead to exclude retina scale patterns: `(?!2x|3x)`.
3. Alternatively, exclude image references and binary file extensions from the PII scanner.

## Implementation Steps
1. Update `EMAIL_REGEX` in `scripts/pii-scan.mjs` with negative lookahead for `@1x|@2x|@3x` image suffixes.
2. Add test cases for image assets with `@2x` suffixes to verify no false positives.
3. Ensure real email addresses continue to be detected accurately.

## Acceptance Criteria
- [ ] `node scripts/pii-scan.mjs` passes when referencing `@2x.png` and `@3x.png` assets.
- [ ] Actual leaked emails (e.g. `user@company.com`) are still flagged.
- [ ] Pre-commit and CI workflows run without false-positive failures.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Removes annoying CI blocker for frontend asset additions.

**GitHub Issue:** [1439](https://github.com/Ethereal-Future/FuTuRe/issues/1439)
