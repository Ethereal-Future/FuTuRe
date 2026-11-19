# ISSUE-252 (#1566): Contact address validation skips the checksum and rejects muxed accounts

**Area:** Backend & Security · **Complexity:** Medium
**File:** `backend/src/routes/contacts.js`

## Summary

The contacts API checks addresses only with a regex. Because of that, it accepts addresses that fail the Stellar checksum and rejects valid muxed (`M...`) accounts. The API also has no way to rename a contact without deleting it and adding it again.

## Current behaviour

```js
// backend/src/routes/contacts.js
const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;
...
body('address').trim().matches(STELLAR_PUBLIC_KEY).withMessage('Invalid Stellar address'),
```

Routes exposed today: `GET /`, `POST /`, `DELETE /:id`. There is no `PUT /:id`.

## Problems

1. **No CRC16 check.** A Stellar StrKey is base32 data that includes a version byte and a 2-byte CRC16-XModem checksum. The regex checks only the alphabet and the length, so a typo such as one swapped character passes. The bad address is saved to the contact directory, and payments sent to it later fail.
2. **Muxed accounts rejected.** Muxed addresses (SEP-23, `M...`, 69 characters) are valid payment destinations, often used by exchanges and custodians. The regex rejects all of them.
3. **No update endpoint.** To rename a contact, the client must delete it and create it again. This loses `createdAt` and the contact ID, and it counts against the per-user rate limiter.

## Remediation

Validate with the SDK. The SDK is already a backend dependency (`@stellar/stellar-sdk`) and is already used this way in `routes/auth.js` and `routes/stellar.js`.

```js
import * as StellarSDK from '@stellar/stellar-sdk';

const isValidContactAddress = (value) =>
  StellarSDK.StrKey.isValidEd25519PublicKey(value) ||
  StellarSDK.StrKey.isValidMed25519PublicKey(value);

body('address')
  .trim()
  .custom(isValidContactAddress)
  .withMessage('Invalid Stellar address'),
```

Add `PUT /:id`:

- Validate `param('id')`, plus `body('name')` (required, max 64 characters, same as POST) and an optional `body('address')` checked with the validator above.
- Scope the update to the authenticated user (`where: { id, userId: user.id }`) so one user cannot edit another user's contacts. Return `404` when nothing matches.
- Map Prisma `P2002` to `409` (the new address duplicates an existing contact).
- Add a `@swagger` block that matches the other routes.

## Acceptance criteria

- [ ] An address with a bad checksum (valid shape, wrong CRC) returns a `400` validation error.
- [ ] A valid muxed `M...` address is accepted by `POST /`.
- [ ] `PUT /:id` renames a contact and keeps its ID and `createdAt`.
- [ ] `PUT /:id` on another user's contact returns `404`.

## Testing notes

- Make a checksum-invalid key by changing the last character of a valid `G...` key to another base32 character.
- Make a muxed address with `new StellarSDK.MuxedAccount(new StellarSDK.Account(gKey, '0'), '1').accountId()`.
- Check whether the `Contact.address` column, or anything that reads it (payment prefill and so on), assumes the address starts with `G`.
