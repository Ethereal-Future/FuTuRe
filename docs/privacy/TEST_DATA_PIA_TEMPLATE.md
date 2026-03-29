# Test Data Privacy Impact Assessment (Template)

Use this when introducing new test datasets, fixtures, snapshots, reports, or test utilities that handle personal data fields.

## 1. Change summary

- What is being added/changed?
- Where will the data live? (tests, fixtures, snapshots, reports, docs)

## 2. Data inventory

List the data fields involved (even if synthetic):

- Identifiers (user ids, public keys)
- Contact fields (email/phone)
- Credentials/secrets (tokens, passwords, secret keys)
- Other personal data (addresses, DOB, national ids, etc.)

## 3. Lawful basis / consent (if applicable)

- Is consent required in the product for this processing?
- Do tests cover consent granted/denied paths?

## 4. Data minimization

- Is every field necessary for the test?
- Can the same outcome be tested with less data?

## 5. Storage & retention

- Where are artifacts stored (local, CI artifacts)?
- Retention period (recommended: 30 days for generated reports)
- Cleanup strategy (manual or automated)

## 6. Redaction & logging

- Are console logs redacted?
- Are snapshots/reports sanitized?
- Does `npm run test:privacy` pass?

## 7. Risk review

- What could leak if artifacts are exposed?
- Mitigations (redaction, strict mode, allowlists, reduced fields)

## 8. Approval

- Reviewer:
- Date:

