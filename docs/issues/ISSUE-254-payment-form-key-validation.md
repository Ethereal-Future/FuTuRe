# ISSUE-254 (#1568): Payment form does not checksum-validate destination and issuer keys

**Area:** Frontend & Operations · **Complexity:** Medium
**File:** `frontend/src/components/operations/PaymentOperationForm.jsx`

## Summary

The payment operation form checks only that `destination` and `issuer` are not empty, and that the destination is not the user's own key. A mistyped public key gets through. The user signs the transaction, and only then does it fail on-chain (for example `op_no_destination` or `op_no_issuer`). If the typo happens to match a real account, the funds go to the wrong place.

## Current behaviour

```js
if (!destination) { setError(t('paymentOperationForm.destinationRequired')); ... }
if (asset !== 'XLM' && !issuer) { setError(t('paymentOperationForm.issuerRequired')); ... }
if (destination === publicKey) { ... }
```

Nothing checks the key format, the version byte or the CRC16 checksum.

## Remediation

`@stellar/stellar-sdk` is already a frontend dependency.

```js
import { StrKey } from '@stellar/stellar-sdk';

const isValidDestination = (v) =>
  StrKey.isValidEd25519PublicKey(v) || StrKey.isValidMed25519PublicKey(v);
const isValidIssuer = (v) => StrKey.isValidEd25519PublicKey(v); // issuers cannot be muxed
```

- Validate on **blur**, and again on change once the field has shown an error, so the user is not interrupted mid-typing. Show the message inline under the field, with `aria-invalid` and `aria-describedby`.
- Also validate in the submit handler, and disable the submit button while either field is invalid. Blur validation can be skipped, for example on paste-and-submit.
- Add i18n keys such as `paymentOperationForm.invalidDestination` and `paymentOperationForm.invalidIssuer`.
- Trim whitespace before validating. Pasted keys often have trailing spaces.

## Acceptance criteria

- [ ] A key with a typo (valid shape, bad checksum) shows an inline error right away.
- [ ] The form cannot be submitted while the destination or issuer is invalid.
- [ ] Valid `G...` destinations and valid `M...` muxed destinations are accepted.

## Related

- ISSUE-252: the same validation gap on the backend contacts API. The frontend and backend should use the same validation rules.
- Other operation forms (for example `ChangeTrustOperationForm` issuer) probably have the same gap. Consider a shared `isValidStellarAddress` helper.
