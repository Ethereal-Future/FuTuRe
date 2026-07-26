import StellarSdk from 'stellar-sdk';
import { horizonServer, networkPassphrase } from '../config/stellar.js';
import logger from '../config/logger.js';

const MAX_STELLAR_LIMIT = '922337203685.4775807'; // Max native limit for Stellar

export async function getBalancesWithLimits(accountId) {
  try {
    if (!accountId) {
      throw new Error('Account ID is required');
    }

    const account = await horizonServer.loadAccount(accountId);

    const balances = account.balances.map((balance) => {
      const isNative = balance.asset_type === 'native';

      if (isNative) {
        return {
          assetCode: 'XLM',
          issuer: null,
          balance: parseFloat(balance.balance),
          limit: null, // XLM has no trustline limit
          buyingLiabilities: parseFloat(balance.buying_liabilities || '0'),
          sellingLiabilities: parseFloat(balance.selling_liabilities || '0'),
        };
      }

      return {
        assetCode: balance.asset_code,
        issuer: balance.asset_issuer,
        balance: parseFloat(balance.balance),
        limit: balance.limit ? parseFloat(balance.limit) : null,
        buyingLiabilities: parseFloat(balance.buying_liabilities || '0'),
        sellingLiabilities: parseFloat(balance.selling_liabilities || '0'),
      };
    });

    // Sort: XLM first, then by asset code
    balances.sort((a, b) => {
      if (a.assetCode === 'XLM') return -1;
      if (b.assetCode === 'XLM') return 1;
      return a.assetCode.localeCompare(b.assetCode);
    });

    return balances;
  } catch (error) {
    logger.error('trustline.getBalancesWithLimits.error', {
      accountId,
      error: error.message,
    });
    throw error;
  }
}

export async function modifyTrustlineLimit(sourceSecret, assetCode, issuer, newLimit) {
  try {
    if (!sourceSecret || !assetCode || !issuer || newLimit === undefined) {
      throw new Error('Missing required parameters: sourceSecret, assetCode, issuer, newLimit');
    }

    // Validate limit is within acceptable range
    const limitNum = parseFloat(newLimit);
    if (limitNum < 0) {
      throw new Error('Limit must be non-negative');
    }

    if (limitNum > parseFloat(MAX_STELLAR_LIMIT)) {
      throw new Error(`Limit cannot exceed ${MAX_STELLAR_LIMIT}`);
    }

    const keypair = StellarSdk.Keypair.fromSecret(sourceSecret);
    const sourceAccount = await horizonServer.loadAccount(keypair.publicKey());

    const asset = new StellarSdk.Asset(assetCode, issuer);

    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.changeTrust({
          asset,
          limit: newLimit.toString(),
        })
      )
      .setTimeout(300)
      .build();

    transaction.sign(keypair);
    const result = await horizonServer.submitTransaction(transaction);

    logger.info('trustline.modify.success', {
      sourceAccount: keypair.publicKey(),
      assetCode,
      issuer,
      newLimit,
      hash: result.hash,
    });

    return {
      success: true,
      hash: result.hash,
      ledger: result.ledger,
      assetCode,
      issuer,
      newLimit: limitNum,
    };
  } catch (error) {
    logger.error('trustline.modify.error', {
      assetCode,
      issuer,
      newLimit,
      error: error.message,
    });
    throw error;
  }
}
