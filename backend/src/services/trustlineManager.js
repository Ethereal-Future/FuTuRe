/**
 * @deprecated TrustlineManagerService is deprecated. Use the consolidated functions in
 * `backend/src/services/stellar.js` instead:
 *   - createTrustline   → stellar.createTrustline(sourceSecret, assetCode, assetIssuer, limit)
 *   - removeTrustline   → stellar.removeTrustline(sourceSecret, assetCode)
 *   - getTrustlines     → stellar.getTrustlines(publicKey)
 *   - updateTrustlineLimit → stellar.updateTrustlineLimit(sourceSecret, assetCode, assetIssuer, newLimit)
 *   - batchCreateTrustlines → stellar.batchCreateTrustlines(sourceSecret, assets)
 * This module will be removed in the next major release.
 */
import * as StellarSdk from '@stellar/stellar-sdk';
import logger from '../config/logger.js';

/**
 * Trustline Manager Service
 */
class TrustlineManagerService {
  /**
   * @param {string} horizonUrl - Horizon server URL to connect to
   * @param {string} networkPassphrase - Network passphrase for transaction signing
   */
  constructor(horizonUrl, networkPassphrase) {
    console.warn(
      '[DEPRECATED] TrustlineManagerService is deprecated and will be removed in the next major release. ' +
      'Use the consolidated functions in backend/src/services/stellar.js instead.',
    );
    this.server = new StellarSdk.Horizon.Server(horizonUrl);
    this.networkPassphrase = networkPassphrase;
  }

  /**
   * @deprecated Use {@link module:stellar.createTrustline} instead.
   * Submit a `changeTrust` operation to create a trustline for an asset.
   * @param {string} sourceSecret - Secret key of the trusting account
   * @param {string} assetCode - Asset code to trust
   * @param {string} assetIssuer - Issuer public key of the asset
   * @param {string|number|null} [limit=null] - Trust limit; omitted for the network default (max)
   * @returns {Promise<{success: boolean, hash: string, asset: {code: string, issuer: string}, limit: string|number|null}>} Submission result
   * @throws {Error} If Horizon submission fails
   */
  async createTrustline(sourceSecret, assetCode, assetIssuer, limit = null) {
    try {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const account = await this.server.loadAccount(sourceKeypair.publicKey());

      const asset = new StellarSdk.Asset(assetCode, assetIssuer);
      
      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.networkPassphrase
      })
        .addOperation(
          StellarSdk.Operation.changeTrust({
            asset: asset,
            limit: limit ? limit.toString() : undefined
          })
        )
        .setTimeout(30)
        .build();

      transaction.sign(sourceKeypair);
      const result = await this.server.submitTransaction(transaction);

      return {
        success: true,
        hash: result.hash,
        asset: { code: assetCode, issuer: assetIssuer },
        limit: limit
      };
    } catch (error) {
      logger.error('trustlineManager.createTrustline.failed', { assetCode, assetIssuer, error: error.message });
      throw error;
    }
  }

  /**
   * @deprecated Use {@link module:stellar.removeTrustline} instead.
   * Remove a trustline by setting its limit to 0.
   * @param {string} sourceSecret - Secret key of the account owning the trustline
   * @param {string} assetCode - Asset code of the trustline to remove
   * @param {string} assetIssuer - Issuer public key of the asset
   * @returns {Promise<{success: boolean, hash: string, asset: {code: string, issuer: string}}>} Submission result
   * @throws {Error} If the account holds a non-zero balance of the asset, or Horizon submission fails
   */
  async removeTrustline(sourceSecret, assetCode, assetIssuer) {
    try {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const account = await this.server.loadAccount(sourceKeypair.publicKey());

      // Check if account has balance in this asset
      const balance = await this.getAssetBalance(sourceKeypair.publicKey(), assetCode, assetIssuer);
      if (balance && parseFloat(balance) > 0) {
        throw new Error('Cannot remove trustline with non-zero balance');
      }

      const asset = new StellarSdk.Asset(assetCode, assetIssuer);
      
      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.networkPassphrase
      })
        .addOperation(
          StellarSdk.Operation.changeTrust({
            asset: asset,
            limit: '0'
          })
        )
        .setTimeout(30)
        .build();

      transaction.sign(sourceKeypair);
      const result = await this.server.submitTransaction(transaction);

      return {
        success: true,
        hash: result.hash,
        asset: { code: assetCode, issuer: assetIssuer }
      };
    } catch (error) {
      logger.error('trustlineManager.removeTrustline.failed', { assetCode, assetIssuer, error: error.message });
      throw error;
    }
  }

  /**
   * @deprecated Use {@link module:stellar.getTrustlines} instead.
   * List all non-native trustlines held by an account.
   * @param {string} publicKey - Stellar public key of the account
   * @returns {Promise<Array<{assetCode: string, assetIssuer: string, balance: string, limit: string, buyingLiabilities: string, sellingLiabilities: string}>>} Trustlines
   * @throws {Error} If the account cannot be loaded
   */
  async getTrustlines(publicKey) {
    try {
      const account = await this.server.loadAccount(publicKey);
      
      return account.balances
        .filter(balance => balance.asset_type !== 'native')
        .map(balance => ({
          assetCode: balance.asset_code,
          assetIssuer: balance.asset_issuer,
          balance: balance.balance,
          limit: balance.limit,
          buyingLiabilities: balance.buying_liabilities,
          sellingLiabilities: balance.selling_liabilities
        }));
    } catch (error) {
      logger.error('trustlineManager.getTrustlines.failed', { publicKey, error: error.message });
      throw error;
    }
  }

  /**
   * Check whether an account already has a trustline for an asset.
   * @param {string} publicKey - Stellar public key of the account
   * @param {string} assetCode - Asset code to check
   * @param {string} assetIssuer - Issuer public key of the asset
   * @returns {Promise<boolean>} True if the trustline exists (false on lookup error too)
   */
  async hasTrustline(publicKey, assetCode, assetIssuer) {
    try {
      const trustlines = await this.getTrustlines(publicKey);
      return trustlines.some(
        tl => tl.assetCode === assetCode && tl.assetIssuer === assetIssuer
      );
    } catch (error) {
      logger.error('trustlineManager.hasTrustline.failed', { publicKey, assetCode, assetIssuer, error: error.message });
      return false;
    }
  }

  /**
   * Get an account's balance of a specific asset.
   * @param {string} publicKey - Stellar public key of the account
   * @param {string} assetCode - Asset code
   * @param {string} assetIssuer - Issuer public key of the asset
   * @returns {Promise<string|null>} Balance as a string, or null if no trustline exists or on error
   */
  async getAssetBalance(publicKey, assetCode, assetIssuer) {
    try {
      const account = await this.server.loadAccount(publicKey);
      const balance = account.balances.find(
        b => b.asset_code === assetCode && b.asset_issuer === assetIssuer
      );
      return balance ? balance.balance : null;
    } catch (error) {
      logger.error('trustlineManager.getAssetBalance.failed', { publicKey, assetCode, assetIssuer, error: error.message });
      return null;
    }
  }

  /**
   * @deprecated Use {@link module:stellar.updateTrustlineLimit} instead.
   * Update an existing trustline's limit.
   * @param {string} sourceSecret - Secret key of the account owning the trustline
   * @param {string} assetCode - Asset code of the trustline to update
   * @param {string} assetIssuer - Issuer public key of the asset
   * @param {string|number} newLimit - New trust limit
   * @returns {Promise<{success: boolean, hash: string, asset: {code: string, issuer: string}, newLimit: string|number}>} Submission result
   * @throws {Error} If Horizon submission fails
   */
  async updateTrustlineLimit(sourceSecret, assetCode, assetIssuer, newLimit) {
    try {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const account = await this.server.loadAccount(sourceKeypair.publicKey());

      const asset = new StellarSdk.Asset(assetCode, assetIssuer);
      
      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.networkPassphrase
      })
        .addOperation(
          StellarSdk.Operation.changeTrust({
            asset: asset,
            limit: newLimit.toString()
          })
        )
        .setTimeout(30)
        .build();

      transaction.sign(sourceKeypair);
      const result = await this.server.submitTransaction(transaction);

      return {
        success: true,
        hash: result.hash,
        asset: { code: assetCode, issuer: assetIssuer },
        newLimit: newLimit
      };
    } catch (error) {
      logger.error('trustlineManager.updateTrustlineLimit.failed', { assetCode, assetIssuer, newLimit, error: error.message });
      throw error;
    }
  }

  /**
   * @deprecated Use {@link module:stellar.batchCreateTrustlines} instead.
   * Create trustlines for multiple assets in sequence, collecting per-asset success/failure.
   * @param {string} sourceSecret - Secret key of the account creating trustlines
   * @param {Array<{code: string, issuer: string, limit?: string|number}>} assets - Assets to trust
   * @returns {Promise<Array<object>>} One result per asset, each either the {@link createTrustline} result plus `asset`, or `{success: false, error, asset}`
   */
  async batchCreateTrustlines(sourceSecret, assets) {
    const results = [];
    
    for (const asset of assets) {
      try {
        const result = await this.createTrustline(
          sourceSecret,
          asset.code,
          asset.issuer,
          asset.limit
        );
        results.push({ ...result, asset });
      } catch (error) {
        results.push({
          success: false,
          error: error.message,
          asset
        });
      }
    }

    return results;
  }
}

export default TrustlineManagerService;
