# Test Data Privacy Framework

This project uses **synthetic test data** and **automatic redaction** to reduce the risk of committing or leaking secrets/PII from tests, snapshots, and reports.

## Goals

- Prevent committing secrets/PII in tracked files (tests, fixtures, docs, reports)
- Redact sensitive values from console output, snapshots, and generated reports
- Provide a lightweight path for GDPR-aligned testing practices (data minimization, retention, auditability)

## What is considered sensitive?

At minimum, treat the following as sensitive in tests and test artifacts:

- Stellar **secret keys** (seed / `secretKey`)
- Access/refresh tokens (e.g. JWTs)
- Passwords, API keys, Authorization headers
- Email addresses (except `@example.*` documentation samples)

## Built-in tooling

### 1) Pre-test scan (tracked files)

`npm test` runs a tracked-files scan first:

```bash
npm run test:privacy
```

This fails the run if likely secrets/PII are detected.

Optional ignore list:

```bash
PII_SCAN_IGNORE="path/substring,another/substr" npm run test:privacy
```

### 2) Console redaction + strict mode

All tests run with a Vitest setup that redacts sensitive values in console output.

Enable strict mode to **fail tests** if secrets/PII are logged:

```bash
TEST_PRIVACY_STRICT=1 npm test
```

### 3) Snapshot / report redaction

- Visual snapshots created via `testing/visual-regression.js` are sanitized before hashing and writing to `__snapshots__/`.
- Reports written via `testing/reporter.js` are sanitized before writing to `test-reports/`.

## Using the helpers

Use `testing/privacy.js` to generate synthetic identifiers and redact values when needed.

- `fakeStellarKeypair()` – generates a format-compatible (non-production) keypair for mocks
- `redactSensitiveData(value)` – deep-redacts objects/arrays for logs, reports, and snapshots

## Data retention policy (tests)

- **Do not** copy production data into tests, fixtures, snapshots, or reports.
- Keep generated test reports (`test-reports/`) only as long as needed for debugging/CI artifact review.
- Recommended default retention for generated reports: **30 days**.

Cleanup helper:

```bash
npm run test:cleanup
```

## Privacy impact assessments (PIA)

If you add tests/fixtures that include personal data fields (even synthetic), complete a short PIA using:

- `docs/privacy/TEST_DATA_PIA_TEMPLATE.md`

## Consent management testing

If a feature processes user personal data, tests must include **consent scenarios** (consent granted/denied) and verify:

- Data is not processed or stored without consent
- Events/logs/snapshots/reports redact identifiers where applicable

