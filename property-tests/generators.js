/**
 * Custom fast-check generators for Stellar domain objects.
 */

import * as fc from 'fast-check';

/** Generates syntactically valid Stellar public key strings (G + 55 base32 chars). */
export const stellarPublicKey = () =>
  fc.stringMatching(/^[A-Z2-7]{55}$/).map(s => `G${s}`);

/** Generates syntactically valid Stellar secret key strings (S + 55 base32 chars). */
export const stellarSecretKey = () =>
  fc.stringMatching(/^[A-Z2-7]{55}$/).map(s => `S${s}`);

/** Generates valid XLM amounts: positive, max 7 decimal places, within Stellar limits. */
export const xlmAmount = () =>
  fc.integer({ min: 1, max: 999_999_999 }).map(stroops => (stroops / 1e7).toFixed(7));

/** Generates valid asset codes: 1-12 uppercase alphanumeric chars. */
export const assetCode = () =>
  fc.stringMatching(/^[A-Z0-9]{1,12}$/);

/** Generates a full payment request object. */
export const paymentRequest = () =>
  fc.record({
    sourceSecret: stellarSecretKey(),
    destination: stellarPublicKey(),
    amount: xlmAmount(),
    assetCode: fc.option(assetCode(), { nil: undefined }),
  });

/** Generates a balance entry as returned by the Stellar API. */
export const balanceEntry = () =>
  fc.record({
    asset_type: fc.constantFrom('native', 'credit_alphanum4', 'credit_alphanum12'),
    balance: xlmAmount(),
    asset_code: fc.option(assetCode(), { nil: undefined }),
  });
