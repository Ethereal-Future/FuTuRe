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

/** Generates valid asset amounts with configurable decimal places (default 7 for XLM). */
export const assetAmount = (decimals = 7) => {
  const maxValue = Math.pow(10, 18 - decimals) - 1;
  return fc.integer({ min: 1, max: maxValue }).map(units => (units / Math.pow(10, decimals)).toFixed(decimals));
};

/** Generates valid XLM amounts: positive, max 7 decimal places, within Stellar limits. */
export const xlmAmount = () => assetAmount(7);

/** Generates valid 4-char asset codes for credit_alphanum4. */
export const assetCodeAlphanum4 = () =>
  fc.stringMatching(/^[A-Z0-9]{4}$/);

/** Generates valid 1-12 char asset codes for credit_alphanum12. */
export const assetCodeAlphanum12 = () =>
  fc.stringMatching(/^[A-Z0-9]{1,12}$/);

/** Generates valid asset codes: 1-12 uppercase alphanumeric chars (alphanum4 or alphanum12). */
export const assetCode = () =>
  fc.oneof(assetCodeAlphanum4(), assetCodeAlphanum12());

/** Generates a Stellar issuer (public key for a non-native asset). */
export const stellarIssuer = () => stellarPublicKey();

/** Generates a non-native asset with code and issuer. */
export const nonNativeAsset = () =>
  fc.record({
    asset_type: fc.constantFrom('credit_alphanum4', 'credit_alphanum12'),
    asset_code: assetCode(),
    asset_issuer: stellarIssuer(),
  });

/** Generates a trustline entry as returned by the Stellar API. */
export const trustlineEntry = () =>
  fc.record({
    asset_type: fc.constantFrom('credit_alphanum4', 'credit_alphanum12'),
    asset_code: assetCode(),
    asset_issuer: stellarIssuer(),
    balance: assetAmount(7),
    limit: assetAmount(7),
    buying_liabilities: assetAmount(7),
    selling_liabilities: assetAmount(7),
  });

/** Generates a path payment request with source and destination assets. */
export const pathPaymentRequest = () =>
  fc.record({
    sourceSecret: stellarSecretKey(),
    sourceAsset: fc.record({
      code: fc.constantFrom('XLM', ...fc.sample(assetCode(), 3)),
      issuer: fc.option(stellarIssuer(), { nil: undefined }),
    }),
    sourceAmount: assetAmount(7),
    destinationAsset: fc.record({
      code: fc.constantFrom('XLM', ...fc.sample(assetCode(), 3)),
      issuer: fc.option(stellarIssuer(), { nil: undefined }),
    }),
    destinationAccount: stellarPublicKey(),
  });

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
    asset_issuer: fc.option(stellarIssuer(), { nil: undefined }),
  });
