import * as StellarSdk from '@stellar/stellar-sdk';
// ISSUE-044: horizonServer and networkPassphrase are now re-exported from the
// canonical config/stellar.js (the file previously did not exist → fatal crash).
import { horizonServer, getNetworkPassphrase } from '../config/stellar.js';
import logger from '../config/logger.js';

const XLM_ASSET = new StellarSdk.Asset.native();

function getAsset(code) {
  if (code === 'XLM') {
    return XLM_ASSET;
  }
  // For other assets, we need to get the issuer from config
  // This is a simplified version - in production, store issuer mapping
  throw new Error(`Asset issuer not configured for ${code}`);
}

/**
 * List an account's open DEX offers.
 * @param {string} accountId - Stellar public key of the account
 * @returns {Promise<Array<{id: string, selling: object, buying: object, amount: string, price_r: {n: number, d: number}, created_at: string}>>} Open offers
 * @throws {Error} If `accountId` is missing or the Horizon lookup fails
 */
export async function getAccountOffers(accountId) {
  try {
    if (!accountId) {
      throw new Error('Account ID is required');
    }

    const offers = await horizonServer.offers().forAccount(accountId).call();

    return (offers.records || []).map((offer) => ({
      id: offer.id,
      selling: {
        asset_type: offer.selling.asset_type,
        asset_code: offer.selling.asset_code,
        asset_issuer: offer.selling.asset_issuer,
      },
      buying: {
        asset_type: offer.buying.asset_type,
        asset_code: offer.buying.asset_code,
        asset_issuer: offer.buying.asset_issuer,
      },
      amount: offer.amount,
      price_r: {
        n: offer.price_r.n,
        d: offer.price_r.d,
      },
      created_at: offer.created_at,
    }));
  } catch (error) {
    logger.error('offer.getAccountOffers.error', {
      accountId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Create a new DEX offer via `manageOffer` (offerId `0`).
 * @param {string} sourceSecret - Secret key of the offering account
 * @param {string} sellingAsset - Asset code being sold (only "XLM" is currently supported by {@link getAsset})
 * @param {string} buyingAsset - Asset code being bought (only "XLM" is currently supported by {@link getAsset})
 * @param {number|string} sellingAmount - Amount of `sellingAsset` to offer
 * @param {number|string} price - Price of 1 unit of `sellingAsset` in units of `buyingAsset`
 * @returns {Promise<{success: boolean, hash: string, ledger: number, offerId: string, sellingAsset: string, buyingAsset: string, sellingAmount: number|string, price: number}>} Submission result
 * @throws {Error} If required parameters are missing, an asset has no configured issuer, or Horizon submission fails
 */
export async function createOffer(sourceSecret, sellingAsset, buyingAsset, sellingAmount, price) {
  try {
    if (!sourceSecret || !sellingAsset || !buyingAsset || !sellingAmount || !price) {
      throw new Error('Missing required parameters');
    }

    const keypair = StellarSdk.Keypair.fromSecret(sourceSecret);
    const sourceAccount = await horizonServer.loadAccount(keypair.publicKey());

    const selling = getAsset(sellingAsset);
    const buying = getAsset(buyingAsset);

    // Convert price to n/d fraction
    const priceNum = parseFloat(price);
    const priceObj = StellarSdk.Fraction.fromDecimal(priceNum.toFixed(7));

    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(
        StellarSdk.Operation.manageOffer({
          selling,
          buying,
          amount: sellingAmount.toString(),
          price: priceObj,
          offerId: '0', // 0 means create new offer
        })
      )
      .setTimeout(300)
      .build();

    transaction.sign(keypair);
    const result = await horizonServer.submitTransaction(transaction);

    logger.info('offer.create.success', {
      sourceAccount: keypair.publicKey(),
      sellingAsset,
      buyingAsset,
      sellingAmount,
      price,
      hash: result.hash,
    });

    // Extract offer ID from result (last created offer ID)
    const offerId = result.result_meta_xdr
      ? 'check_horizon'
      : 'pending';

    return {
      success: true,
      hash: result.hash,
      ledger: result.ledger,
      offerId,
      sellingAsset,
      buyingAsset,
      sellingAmount,
      price: priceNum,
    };
  } catch (error) {
    logger.error('offer.create.error', {
      sellingAsset,
      buyingAsset,
      sellingAmount,
      price,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Modify an existing DEX offer via `manageOffer` with a non-zero `offerId`.
 * @param {string} sourceSecret - Secret key of the offering account
 * @param {string|number} offerId - Id of the offer to modify
 * @param {string} sellingAsset - Asset code being sold
 * @param {string} buyingAsset - Asset code being bought
 * @param {number|string} sellingAmount - New amount of `sellingAsset` to offer
 * @param {number|string} price - New price of 1 unit of `sellingAsset` in units of `buyingAsset`
 * @returns {Promise<{success: boolean, hash: string, ledger: number, offerId: string|number}>} Submission result
 * @throws {Error} If required parameters are missing or Horizon submission fails
 */
export async function modifyOffer(
  sourceSecret,
  offerId,
  sellingAsset,
  buyingAsset,
  sellingAmount,
  price
) {
  try {
    if (!sourceSecret || offerId === undefined || !sellingAsset || !buyingAsset) {
      throw new Error('Missing required parameters');
    }

    const keypair = StellarSdk.Keypair.fromSecret(sourceSecret);
    const sourceAccount = await horizonServer.loadAccount(keypair.publicKey());

    const selling = getAsset(sellingAsset);
    const buying = getAsset(buyingAsset);

    const priceNum = parseFloat(price);
    const priceObj = StellarSdk.Fraction.fromDecimal(priceNum.toFixed(7));

    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(
        StellarSdk.Operation.manageOffer({
          selling,
          buying,
          amount: sellingAmount.toString(),
          price: priceObj,
          offerId: offerId.toString(),
        })
      )
      .setTimeout(300)
      .build();

    transaction.sign(keypair);
    const result = await horizonServer.submitTransaction(transaction);

    logger.info('offer.modify.success', {
      sourceAccount: keypair.publicKey(),
      offerId,
      sellingAsset,
      buyingAsset,
      hash: result.hash,
    });

    return {
      success: true,
      hash: result.hash,
      ledger: result.ledger,
      offerId,
    };
  } catch (error) {
    logger.error('offer.modify.error', {
      offerId,
      sellingAsset,
      buyingAsset,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Cancel an existing DEX offer by submitting `manageOffer` with a zero amount.
 * @param {string} sourceSecret - Secret key of the offering account
 * @param {string|number} offerId - Id of the offer to cancel
 * @returns {Promise<{success: boolean, hash: string, ledger: number, offerId: string|number}>} Submission result
 * @throws {Error} If required parameters are missing or Horizon submission fails
 */
export async function cancelOffer(sourceSecret, offerId) {
  try {
    if (!sourceSecret || offerId === undefined) {
      throw new Error('Missing required parameters: sourceSecret, offerId');
    }

    const keypair = StellarSdk.Keypair.fromSecret(sourceSecret);
    const sourceAccount = await horizonServer.loadAccount(keypair.publicKey());

    // Cancel by setting amount to 0
    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(
        StellarSdk.Operation.manageOffer({
          selling: XLM_ASSET,
          buying: XLM_ASSET,
          amount: '0',
          price: '1',
          offerId: offerId.toString(),
        })
      )
      .setTimeout(300)
      .build();

    transaction.sign(keypair);
    const result = await horizonServer.submitTransaction(transaction);

    logger.info('offer.cancel.success', {
      sourceAccount: keypair.publicKey(),
      offerId,
      hash: result.hash,
    });

    return {
      success: true,
      hash: result.hash,
      ledger: result.ledger,
      offerId,
    };
  } catch (error) {
    logger.error('offer.cancel.error', {
      offerId,
      error: error.message,
    });
    throw error;
  }
}

// ── ISSUE-049: Self-trade detection & passive offer ──────────────────────────

/**
 * Asset comparison helper — returns true when two Horizon asset descriptors
 * (from the offers API) refer to the same asset.
 *
 * @param {object} a - Horizon offer asset descriptor
 * @param {object} b - Horizon offer asset descriptor
 * @returns {boolean}
 */
function assetsMatch(a, b) {
  if (a.asset_type === 'native' && b.asset_type === 'native') return true;
  return (
    a.asset_type === b.asset_type &&
    a.asset_code === b.asset_code &&
    a.asset_issuer === b.asset_issuer
  );
}

/**
 * Inspect the source account's open offers to detect potential self-trades
 * against a proposed passive offer.
 *
 * A self-trade occurs when the account has an existing *sell* offer whose
 * selling asset equals the proposed offer's buying asset AND whose buying asset
 * equals the proposed offer's selling asset, at a price that would cross with
 * the new passive offer price.
 *
 * Passive offers execute against orders at a *better* price (strictly, for a
 * passive sell the passive offer's price ≤ the existing buy offer's price), so
 * a crossing situation arises when:
 *   existingOffer.price  >=  passiveOfferPrice
 *
 * (where both prices are expressed as "units of buying per unit of selling").
 *
 * @param {string} sourcePublicKey - Account public key to check
 * @param {object} sellingAssetDesc - Asset descriptor `{ asset_type, asset_code?, asset_issuer? }` for the asset being sold
 * @param {object} buyingAssetDesc  - Asset descriptor for the asset being bought
 * @param {number} price - Price of 1 unit of sellingAsset in units of buyingAsset
 * @returns {Promise<{selfTradeDetected: boolean, crossingOffers: Array<{id: string, price: number}>}>}
 */
export async function checkSelfTrade(sourcePublicKey, sellingAssetDesc, buyingAssetDesc, price) {
  try {
    const offersPage = await horizonServer.offers().forAccount(sourcePublicKey).call();
    const existingOffers = offersPage.records ?? [];
    const passivePrice = parseFloat(price);
    const crossingOffers = [];

    for (const offer of existingOffers) {
      // A crossing offer sells what the new passive offer buys, and vice versa.
      const offerSellsOurBuy  = assetsMatch(offer.selling, buyingAssetDesc);
      const offerBuysOurSell  = assetsMatch(offer.buying,  sellingAssetDesc);

      if (offerSellsOurBuy && offerBuysOurSell) {
        // Existing offer price is in "buying per selling" for its own perspective,
        // i.e. "units of sellingAssetDesc per unit of buyingAssetDesc" from ours.
        // Passive sell executes when existing (implicit) buy price >= passive price.
        const existingPrice = parseFloat(offer.price);
        if (existingPrice >= passivePrice) {
          crossingOffers.push({ id: offer.id, price: existingPrice });
        }
      }
    }

    return {
      selfTradeDetected: crossingOffers.length > 0,
      crossingOffers,
    };
  } catch (error) {
    logger.error('offer.checkSelfTrade.error', {
      sourcePublicKey,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Helper to build a minimal Horizon asset descriptor from an asset code string.
 * Accepts `'XLM'` (native) or `'CODE:ISSUER'` format.
 *
 * @param {string} assetCode - e.g. 'XLM' or 'USDC:GABC...'
 * @returns {{ asset_type: string, asset_code?: string, asset_issuer?: string }}
 */
function assetDescriptor(assetCode) {
  if (assetCode === 'XLM') {
    return { asset_type: 'native' };
  }
  const [code, issuer] = assetCode.split(':');
  const asset_type = code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12';
  return { asset_type, asset_code: code, asset_issuer: issuer };
}

/**
 * Create a passive sell offer on the Stellar DEX.
 *
 * Passive offers do not cross orders at the same price but will execute at a
 * better price.  Before submitting, this function checks the account's existing
 * open offers for potential self-trades.  When a self-trade is detected, the
 * function either:
 *   - Automatically cancels the crossing offer (append a `manageSellOffer`
 *     with `amount: '0'`) when `autoCancelCrossing` is `true` (default), or
 *   - Returns a warning with `selfTradeWarning: true` without submitting when
 *     `autoCancelCrossing` is `false`.
 *
 * @param {string} sourceSecret - Secret key of the offering account
 * @param {string} sellingAsset - Asset code being sold (e.g. 'XLM' or 'USDC:GABC...')
 * @param {string} buyingAsset  - Asset code being bought
 * @param {number|string} sellingAmount - Amount of `sellingAsset` to offer
 * @param {number|string} price - Price of 1 unit of `sellingAsset` in units of `buyingAsset`
 * @param {object}  [opts={}]
 * @param {boolean} [opts.autoCancelCrossing=true] - When `true`, crossing offers are cancelled atomically in the same transaction
 * @returns {Promise<{success: boolean, hash?: string, ledger?: number, selfTradeWarning?: boolean, crossingOffers?: Array}>} Submission result
 * @throws {Error} If required parameters are missing or Horizon submission fails
 */
export async function createPassiveOffer(
  sourceSecret,
  sellingAsset,
  buyingAsset,
  sellingAmount,
  price,
  { autoCancelCrossing = true } = {}
) {
  try {
    if (!sourceSecret || !sellingAsset || !buyingAsset || !sellingAmount || !price) {
      throw new Error('Missing required parameters');
    }

    const keypair = StellarSdk.Keypair.fromSecret(sourceSecret);
    const sourcePublicKey = keypair.publicKey();

    const sellingDesc = assetDescriptor(sellingAsset);
    const buyingDesc  = assetDescriptor(buyingAsset);

    // ── Self-trade check ──────────────────────────────────────────────────
    const { selfTradeDetected, crossingOffers } = await checkSelfTrade(
      sourcePublicKey,
      sellingDesc,
      buyingDesc,
      price
    );

    if (selfTradeDetected && !autoCancelCrossing) {
      logger.warn('offer.createPassive.selfTradeDetected', {
        sourcePublicKey,
        sellingAsset,
        buyingAsset,
        price,
        crossingOffers,
      });
      return {
        success: false,
        selfTradeWarning: true,
        crossingOffers,
        message:
          'Self-trade detected: the proposed passive offer would cross your own ' +
          'active orderbook bids. Set autoCancelCrossing=true or cancel the ' +
          'conflicting offers manually before proceeding.',
      };
    }
    // ─────────────────────────────────────────────────────────────────────

    const sourceAccount = await horizonServer.loadAccount(sourcePublicKey);

    const selling = sellingAsset === 'XLM'
      ? XLM_ASSET
      : new StellarSdk.Asset(...sellingAsset.split(':'));
    const buying  = buyingAsset === 'XLM'
      ? XLM_ASSET
      : new StellarSdk.Asset(...buyingAsset.split(':'));

    const priceNum = parseFloat(price);
    const priceObj = StellarSdk.Fraction.fromDecimal(priceNum.toFixed(7));

    const txBuilder = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase,
    });

    // Atomically cancel any crossing offers first.
    if (selfTradeDetected && autoCancelCrossing) {
      for (const crossing of crossingOffers) {
        txBuilder.addOperation(
          StellarSdk.Operation.manageSellOffer({
            selling: buying,   // the crossing offer sells what we buy
            buying:  selling,  // and buys what we sell
            amount: '0',
            price: '1',
            offerId: crossing.id,
          })
        );
      }
      logger.info('offer.createPassive.cancellingCrossingOffers', {
        sourcePublicKey,
        count: crossingOffers.length,
      });
    }

    txBuilder.addOperation(
      StellarSdk.Operation.createPassiveSellOffer({
        selling,
        buying,
        amount: sellingAmount.toString(),
        price: priceObj,
      })
    );

    const transaction = txBuilder.setTimeout(300).build();
    transaction.sign(keypair);
    const result = await horizonServer.submitTransaction(transaction);

    logger.info('offer.createPassive.success', {
      sourcePublicKey,
      sellingAsset,
      buyingAsset,
      sellingAmount,
      price,
      selfTradeDetected,
      cancelledOffers: selfTradeDetected ? crossingOffers.length : 0,
      hash: result.hash,
    });

    return {
      success: true,
      hash: result.hash,
      ledger: result.ledger,
      sellingAsset,
      buyingAsset,
      sellingAmount,
      price: priceNum,
      selfTradeDetected,
      crossingOffers: selfTradeDetected ? crossingOffers : [],
    };
  } catch (error) {
    logger.error('offer.createPassive.error', {
      sellingAsset,
      buyingAsset,
      sellingAmount,
      price,
      error: error.message,
    });
    throw error;
  }
}
