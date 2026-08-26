import * as StellarSdk from '@stellar/stellar-sdk';
import logger from '../config/logger.js';

/**
 * Asset Conversion Utility Service.
 * Wraps Stellar path-payment and orderbook lookups to find conversion paths,
 * execute cross-asset payments, and quote conversion rates with short-lived caching.
 */
class AssetConverterService {
  /**
   * @param {string} horizonUrl - Horizon server URL to connect to
   * @param {string} networkPassphrase - Network passphrase for transaction signing (testnet/mainnet)
   */
  constructor(horizonUrl, networkPassphrase) {
    this.server = new StellarSdk.Horizon.Server(horizonUrl);
    this.networkPassphrase = networkPassphrase;
    this._rateCache = new Map();
    this._rateTtl = parseInt(process.env.RATE_CACHE_TTL_SECONDS ?? '30', 10);
    if (this._rateTtl < 5) {
      logger.warn('assetConverter.config.lowCacheTtl', {
        rateTtlSeconds: this._rateTtl,
        message: 'RATE_CACHE_TTL_SECONDS is very low — possible misconfiguration',
      });
    }
  }

  /**
   * Find available strict-send payment paths from one asset to another.
   * @param {string} sourceAsset - Source asset, "XLM"/"native" or "CODE:ISSUER"
   * @param {string} destAsset - Destination asset, "XLM"/"native" or "CODE:ISSUER"
   * @param {number|string} amount - Amount of `sourceAsset` to send
   * @returns {Promise<Array<{sourceAmount: string, destAmount: string, path: Array<{code: string, issuer: string|null}>}>>} Candidate paths, unsorted
   * @throws {Error} If the Horizon strict-send-paths lookup fails
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
      logger.error('assetConverter.findConversionPath.failed', { sourceAsset, destAsset, amount, error: error.message });
      throw error;
    }
  }

  /**
   * Convert an asset to another by submitting a `pathPaymentStrictSend` operation
   * paid to the source account's own public key.
   * @param {string} sourceSecret - Secret key of the converting account
   * @param {string} sourceAsset - Asset to send, "XLM"/"native" or "CODE:ISSUER"
   * @param {string} destAsset - Asset to receive, "XLM"/"native" or "CODE:ISSUER"
   * @param {number|string} amount - Amount of `sourceAsset` to send
   * @param {number|string} destMin - Minimum acceptable amount of `destAsset` received (slippage floor)
   * @returns {Promise<{success: boolean, hash: string, sourceAsset: string, destAsset: string, sourceAmount: number|string, destAmount: number|string}>} Submission result
   * @throws {Error} If Horizon submission fails
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
      logger.error('assetConverter.convertAsset.failed', { sourceAsset, destAsset, amount, error: error.message });
      throw error;
    }
  }

  /**
   * Get conversion rate, memoized within the current TTL window.
   * All calls for the same pair within RATE_CACHE_TTL_SECONDS share one Horizon fetch.
   * @param {string} sourceAsset - Source asset, "XLM"/"native" or "CODE:ISSUER"
   * @param {string} destAsset - Destination asset, "XLM"/"native" or "CODE:ISSUER"
   * @returns {Promise<number|null>} Best bid price from the DEX orderbook, or null if unavailable/on error
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
      logger.error('assetConverter.getConversionRate.failed', { sourceAsset, destAsset, error: error.message });
      return null;
    }
  }

  /**
   * Quote the destination amount for converting `amount` of `sourceAsset` to `destAsset`,
   * using the current cached orderbook rate.
   * @param {string} sourceAsset - Source asset, "XLM"/"native" or "CODE:ISSUER"
   * @param {string} destAsset - Destination asset, "XLM"/"native" or "CODE:ISSUER"
   * @param {number} amount - Amount of `sourceAsset` to convert
   * @returns {Promise<{sourceAsset: string, destAsset: string, sourceAmount: number, destAmount: number, rate: number, timestamp: Date}|null>} Quote, or null if no rate is available
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
   * Parse an asset string into a Stellar SDK `Asset` instance.
   * @param {string} assetString - "XLM"/"native" for the native asset, or "CODE:ISSUER" for an issued asset
   * @returns {import('@stellar/stellar-sdk').Asset} Parsed asset
   */
  parseAsset(assetString) {
    if (assetString === 'XLM' || assetString === 'native') {
      return StellarSdk.Asset.native();
    }

    const [code, issuer] = assetString.split(':');
    return new StellarSdk.Asset(code, issuer);
  }

  /**
   * Find the conversion path yielding the largest destination amount.
   * @param {string} sourceAsset - Source asset, "XLM"/"native" or "CODE:ISSUER"
   * @param {string} destAsset - Destination asset, "XLM"/"native" or "CODE:ISSUER"
   * @param {number|string} amount - Amount of `sourceAsset` to send
   * @returns {Promise<{sourceAmount: string, destAmount: string, path: Array<{code: string, issuer: string|null}>}|null>} Best path, or null if none exist
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
