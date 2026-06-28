import * as StellarSdk from '@stellar/stellar-sdk';

/**
 * Asset Conversion Utility Service
 */
class AssetConverterService {
  constructor(horizonUrl, networkPassphrase) {
    this.server = new StellarSdk.Horizon.Server(horizonUrl);
    this.networkPassphrase = networkPassphrase;
    this._rateCache = new Map();
    this._rateTtl = parseInt(process.env.RATE_CACHE_TTL_SECONDS ?? '30', 10);
    if (this._rateTtl < 5) {
      console.warn(
        `[assetConverter] RATE_CACHE_TTL_SECONDS=${this._rateTtl}s is very low — possible misconfiguration`,
      );
    }
  }

  /**
   * Find conversion path between assets
   */
  async findConversionPath(sourceAsset, destAsset, amount) {
    try {
      const source = this.parseAsset(sourceAsset);
      const dest = this.parseAsset(destAsset);

      const paths = await this.server.strictSendPaths(source, amount.toString(), [dest]).call();

      return paths.records.map((path) => ({
        sourceAmount: path.source_amount,
        destAmount: path.destination_amount,
        path: path.path.map((p) => ({
          code: p.asset_code || 'XLM',
          issuer: p.asset_issuer || null,
        })),
      }));
    } catch (error) {
      console.error('Find conversion path error:', error);
      throw error;
    }
  }

  /**
   * Convert asset using path payment
   */
  async convertAsset(sourceSecret, sourceAsset, destAsset, amount, destMin) {
    try {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const account = await this.server.loadAccount(sourceKeypair.publicKey());

      const source = this.parseAsset(sourceAsset);
      const dest = this.parseAsset(destAsset);

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.pathPaymentStrictSend({
            sendAsset: source,
            sendAmount: amount.toString(),
            destination: sourceKeypair.publicKey(),
            destAsset: dest,
            destMin: destMin.toString(),
          }),
        )
        .setTimeout(30)
        .build();

      transaction.sign(sourceKeypair);
      const result = await this.server.submitTransaction(transaction);

      return {
        success: true,
        hash: result.hash,
        sourceAsset,
        destAsset,
        sourceAmount: amount,
        destAmount: destMin,
      };
    } catch (error) {
      console.error('Asset conversion error:', error);
      throw error;
    }
  }

  /**
   * Get conversion rate, memoized within the current TTL window.
   * All calls for the same pair within RATE_CACHE_TTL_SECONDS share one Horizon fetch.
   */
  async getConversionRate(sourceAsset, destAsset) {
    const intervalKey = Math.floor(Date.now() / (this._rateTtl * 1000));
    const cacheKey = `${sourceAsset}:${destAsset}:${intervalKey}`;

    if (this._rateCache.has(cacheKey)) {
      return this._rateCache.get(cacheKey);
    }

    // Evict expired entries
    for (const key of this._rateCache.keys()) {
      const storedInterval = parseInt(key.slice(key.lastIndexOf(':') + 1), 10);
      if (storedInterval < intervalKey) {
        this._rateCache.delete(key);
      }
    }

    try {
      const source = this.parseAsset(sourceAsset);
      const dest = this.parseAsset(destAsset);
      const orderbook = await this.server.orderbook(source, dest).call();
      const rate = orderbook.bids.length > 0 ? parseFloat(orderbook.bids[0].price) : null;
      this._rateCache.set(cacheKey, rate);
      return rate;
    } catch (error) {
      console.error('Get conversion rate error:', error);
      return null;
    }
  }

  /**
   * Calculate conversion output
   */
  async calculateConversion(sourceAsset, destAsset, amount) {
    const rate = await this.getConversionRate(sourceAsset, destAsset);

    if (!rate) {
      return null;
    }

    return {
      sourceAsset,
      destAsset,
      sourceAmount: amount,
      destAmount: amount * rate,
      rate,
      timestamp: new Date(),
    };
  }

  /**
   * Parse asset string to Stellar Asset object
   */
  parseAsset(assetString) {
    if (assetString === 'XLM' || assetString === 'native') {
      return StellarSdk.Asset.native();
    }

    const [code, issuer] = assetString.split(':');
    return new StellarSdk.Asset(code, issuer);
  }

  /**
   * Get best conversion path
   */
  async getBestConversionPath(sourceAsset, destAsset, amount) {
    const paths = await this.findConversionPath(sourceAsset, destAsset, amount);

    if (paths.length === 0) {
      return null;
    }

    // Find path with best destination amount
    return paths.reduce((best, current) => {
      return parseFloat(current.destAmount) > parseFloat(best.destAmount) ? current : best;
    });
  }
}

export default AssetConverterService;
