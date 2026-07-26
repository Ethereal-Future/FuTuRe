import StellarSdk from 'stellar-sdk';
import { horizonServer, networkPassphrase } from '../config/stellar.js';
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
      networkPassphrase,
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
      networkPassphrase,
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
      networkPassphrase,
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
