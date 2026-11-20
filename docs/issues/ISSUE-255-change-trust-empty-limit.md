# ISSUE-255 (#1569): Clearing the ChangeTrust limit field deletes the trustline

**Area:** Frontend & Operations · **Complexity:** High
**File:** `frontend/src/components/operations/ChangeTrustOperationForm.jsx`

## Summary

If the user clears the limit field, the form sends `limit: '0'`. In Stellar, a `changeTrust` with limit `0` **removes the trustline**. A user who wanted the maximum limit can therefore delete their trustline without being told. If the trustline still holds a balance, the operation fails. If the balance is zero, the trustline is removed with no warning.

## Current behaviour

```js
const [limit, setLimit] = useState('922337203685.4775807'); // sensible default
...
if (limit && (isNaN(limit) || parseFloat(limit) < 0)) { ... }  // empty string skips validation
onAdd({ asset: { code: assetCode, issuer }, limit: limit || '0' }); // empty becomes '0', which deletes
```

The default value is correct, but the fallback for an empty field does the opposite of what the user expects.

## Remediation

1. **An empty field means the maximum limit.** Change the fallback:
   ```js
   const MAX_TRUST_LIMIT = '922337203685.4775807'; // (2^63 - 1) stroops
   limit: limit.trim() === '' ? MAX_TRUST_LIMIT : limit,
   ```
   You can also omit `limit` entirely. `Operation.changeTrust` uses the maximum when no limit is given.
2. **Make deletion an explicit action.** If the user types `0`, do not submit it straight away. Show a confirmation, for example "This will remove your trustline for CODE. Continue?". Better still, offer a separate "Remove trustline" control so a `0` limit never comes from the free-text field.
3. **Tighten the input checks.** Reject values above `MAX_TRUST_LIMIT` and values with more than 7 decimal places. `parseFloat` loses precision near the maximum, so compare the string or use a decimal library.
4. Use the `MAX_TRUST_LIMIT` constant for both the initial state and the post-submit reset (both are currently string literals).

## Acceptance criteria

- [ ] Submitting with an empty limit creates or keeps a trustline with the maximum limit.
- [ ] A trustline is removed only after an explicit, confirmed delete action.
- [ ] Limits above the maximum, or with more than 7 decimal places, show a validation error.

## Testing notes

Unit test `onAdd` in three cases:
- empty input gives `MAX_TRUST_LIMIT` (or no `limit`)
- `'100'` gives `'100'`
- `'0'` without confirmation does not call `onAdd`
