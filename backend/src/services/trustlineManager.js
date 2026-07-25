import * as StellarSdk from '@stellar/stellar-sdk';

/**
 * Trustline Manager Service
 */
class TrustlineManagerService {
  constructor(horizonUrl, networkPassphrase) {
    this.server = new StellarSdk.Horizon.Server(horizonUrl);
    this.networkPassphrase = networkPassphrase;
  }

  /**
   * Create trustline for an asset
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
      console.error('Trustline creation error:', error);
      throw error;
    }
  }

  /**
   * Remove trustline (set limit to 0)
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
      console.error('Trustline removal error:', error);
      throw error;
    }
  }

  /**
   * Get all trustlines for an account
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
      console.error('Get trustlines error:', error);
      throw error;
    }
  }

  /**
   * Check if trustline exists
   */
  async hasTrustline(publicKey, assetCode, assetIssuer) {
    try {
      const trustlines = await this.getTrustlines(publicKey);
      return trustlines.some(
        tl => tl.assetCode === assetCode && tl.assetIssuer === assetIssuer
      );
    } catch (error) {
      console.error('Check trustline error:', error);
      return false;
    }
  }

  /**
   * Get asset balance
   */
  async getAssetBalance(publicKey, assetCode, assetIssuer) {
    try {
      const account = await this.server.loadAccount(publicKey);
      const balance = account.balances.find(
        b => b.asset_code === assetCode && b.asset_issuer === assetIssuer
      );
      return balance ? balance.balance : null;
    } catch (error) {
      console.error('Get balance error:', error);
      return null;
    }
  }

  /**
   * Update trustline limit
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
      console.error('Update trustline limit error:', error);
      throw error;
    }
  }

  /**
   * Batch create trustlines
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
