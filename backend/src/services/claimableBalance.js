import * as StellarSDK from '@stellar/stellar-sdk';
import logger from '../config/logger.js';
import { getHorizonServer, getNetworkPassphrase, withHorizonRetry } from './stellar.js';

/**
 * Minimum number of seconds that a `beforeAbsoluteTime` predicate must be in
 * the future relative to the current server time. This guards against balances
 * that would be immediately unclaimable upon creation.
 */
export const MIN_EXPIRY_BUFFER_SECONDS = 300;

/**
 * Validate that a `beforeAbsoluteTime` UNIX timestamp is sufficiently in the
 * future.  Throws a `ValidationError` if:
 *   - The value is not a positive integer, or
 *   - It is less than `now + MIN_EXPIRY_BUFFER_SECONDS`.
 *
 * @param {number} beforeAbsoluteTime - UNIX epoch seconds for the expiry predicate
 * @throws {ValidationError}
 */
export function validateExpiryTimestamp(beforeAbsoluteTime) {
  if (
    typeof beforeAbsoluteTime !== 'number' ||
    !Number.isInteger(beforeAbsoluteTime) ||
    beforeAbsoluteTime <= 0
  ) {
    throw new ValidationError(
      'beforeAbsoluteTime must be a positive integer UNIX timestamp (seconds)',
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const minAllowed = nowSeconds + MIN_EXPIRY_BUFFER_SECONDS;

  if (beforeAbsoluteTime < minAllowed) {
    throw new ValidationError(
      `beforeAbsoluteTime must be at least ${MIN_EXPIRY_BUFFER_SECONDS} seconds in the future ` +
        `(minimum: ${minAllowed}, received: ${beforeAbsoluteTime})`,
    );
  }
}

/**
 * Create a claimable balance on the Stellar network.
 *
 * The balance can be claimed by any of the provided claimants. When
 * `beforeAbsoluteTime` is supplied the balance is wrapped in a
 * `ClaimPredicate.beforeAbsoluteTime` predicate — the timestamp is validated
 * before the operation is built to prevent creation of immediately unclaimable
 * balances.
 *
 * @param {object} opts
 * @param {string}   opts.sourceSecret          - Secret key of the sponsoring account
 * @param {string[]} opts.claimantAddresses      - Stellar public keys of the claimants
 * @param {string}   opts.assetCode              - Asset code (e.g. 'XLM')
 * @param {string}   opts.assetIssuer            - Asset issuer public key (null for XLM)
 * @param {string}   opts.amount                 - Amount as a string in asset units
 * @param {number}   [opts.beforeAbsoluteTime]   - Optional UNIX timestamp (seconds) expiry
 * @returns {Promise<{ hash: string, balanceId: string }>}
 */
export async function createClaimableBalance({
  sourceSecret,
  claimantAddresses,
  assetCode,
  assetIssuer,
  amount,
  beforeAbsoluteTime,
}) {
  if (!Array.isArray(claimantAddresses) || claimantAddresses.length === 0) {
    throw new ValidationError('At least one claimant address is required');
  }

  // Validate expiry before building any operations.
  if (beforeAbsoluteTime !== undefined && beforeAbsoluteTime !== null) {
    validateExpiryTimestamp(beforeAbsoluteTime);
  }

  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourcePublicKey = sourceKeypair.publicKey();

  const asset =
    assetCode === 'XLM' || !assetIssuer
      ? StellarSDK.Asset.native()
      : new StellarSDK.Asset(assetCode, assetIssuer);

  // Build the predicate — either unconditional or time-bounded.
  const predicate =
    beforeAbsoluteTime !== undefined && beforeAbsoluteTime !== null
      ? StellarSDK.Claimant.predicateBeforeAbsoluteTime(String(beforeAbsoluteTime))
      : StellarSDK.Claimant.predicateUnconditional();

  const claimants = claimantAddresses.map(
    (address) => new StellarSDK.Claimant(address, predicate),
  );

  const sourceAccount = await withHorizonRetry(() =>
    getHorizonServer().loadAccount(sourcePublicKey),
  );

  const transaction = new StellarSDK.TransactionBuilder(sourceAccount, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(
      StellarSDK.Operation.createClaimableBalance({
        asset,
        amount: String(amount),
        claimants,
      }),
    )
    .setTimeout(30)
    .build();

  transaction.sign(sourceKeypair);

  logger.info('claimableBalance.create', {
    source: sourcePublicKey,
    claimants: claimantAddresses,
    assetCode,
    amount,
    beforeAbsoluteTime: beforeAbsoluteTime ?? null,
  });

  const result = await withHorizonRetry(() =>
    getHorizonServer().submitTransaction(transaction),
  );

  // The balance ID is emitted in the operation result XDR.
  let balanceId = null;
  try {
    const txResult = StellarSDK.xdr.TransactionResult.fromXDR(result.result_xdr, 'base64');
    const opResults = txResult.result().results();
    if (opResults.length > 0) {
      const opInner = opResults[0].tr().createClaimableBalanceResult();
      balanceId = StellarSDK.StrKey.encodeBalanceID(
        opInner.balanceID().toXDR(),
      );
    }
  } catch (parseErr) {
    logger.warn('claimableBalance.create.balanceIdParseFailed', { error: parseErr.message });
  }

  logger.info('claimableBalance.created', {
    source: sourcePublicKey,
    hash: result.hash,
    balanceId,
  });

  return { hash: result.hash, balanceId };
}

/**
 * Error used when request input data fails validation.
 */
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.statusCode = 400;
  }
}
