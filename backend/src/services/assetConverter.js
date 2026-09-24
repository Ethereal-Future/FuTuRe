import * as StellarSdk from '@stellar/stellar-sdk';
import logger from '../config/logger.js';
import { getRate as getFiatRate } from './exchangeRate.js';

/** Sources whose liquidity is worth less than this (in USD) are ignored for pricing. 0 disables the filter. */
const MIN_POOL_LIQUIDITY_USD = parseFloat(process.env.MIN_POOL_LIQUIDITY_USD ?? '1000');
/** Sources contributing less than this share of the largest source's weight are treated as outliers. */
const MIN_RELATIVE_LIQUIDITY = 0.01;
/** Orderbook levels (per side) counted towards DEX depth. */
const ORDERBOOK_DEPTH_LEVELS = 20;

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
   * Get the liquidity-weighted conversion rate, memoized within the current TTL window.
   * All calls for the same pair within RATE_CACHE_TTL_SECONDS share one Horizon fetch.
   * @param {string} sourceAsset - Source asset, "XLM"/"native" or "CODE:ISSUER"
   * @param {string} destAsset - Destination asset, "XLM"/"native" or "CODE:ISSUER"
   * @returns {Promise<number|null>} Liquidity-weighted mid price (dest per source), or null if unavailable/on error
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
      const sources = await this.getPriceSources(source, dest);
      const rate = await this.computeLiquidityWeightedRate(sources, dest);
      this._rateCache.set(cacheKey, rate);
      return rate;
    } catch (error) {
      logger.error('assetConverter.getConversionRate.failed', { sourceAsset, destAsset, error: error.message });
      return null;
    }
  }

  /**
   * Collect every price source for a pair: the DEX orderbook plus each AMM
   * liquidity pool holding both assets.
   * Each source reports a mid price (dest per source), its reserves/depth in
   * both assets, and its total value denominated in the destination asset.
   * @param {import('@stellar/stellar-sdk').Asset} source
   * @param {import('@stellar/stellar-sdk').Asset} dest
   * @returns {Promise<Array<{kind: string, id: string, midPrice: number, sourceReserve: number, destReserve: number, valueInDest: number}>>}
   */
  async getPriceSources(source, dest) {
    const [orderbookResult, poolsResult] = await Promise.allSettled([
      this.server.orderbook(source, dest).limit(ORDERBOOK_DEPTH_LEVELS).call(),
      this.server.liquidityPools().forAssets(source, dest).call(),
    ]);

    const sources = [];

    if (orderbookResult.status === 'fulfilled') {
      const ob = this.orderbookSource(orderbookResult.value);
      if (ob) sources.push(ob);
    } else {
      logger.warn('assetConverter.orderbook.failed', { error: orderbookResult.reason?.message });
    }

    if (poolsResult.status === 'fulfilled') {
      for (const record of poolsResult.value.records ?? []) {
        const pool = this.poolSource(record, source, dest);
        if (pool) sources.push(pool);
      }
    } else {
      logger.warn('assetConverter.liquidityPools.failed', { error: poolsResult.reason?.message });
    }

    return sources;
  }

  /**
   * Normalise a Horizon orderbook (selling=source, buying=dest) into a price source.
   * Prices are dest per source; ask amounts are in the source asset, bid amounts
   * in the dest asset (offers are always denominated in what they sell).
   */
  orderbookSource(orderbook) {
    const bids = orderbook.bids ?? [];
    const asks = orderbook.asks ?? [];
    if (bids.length === 0 && asks.length === 0) return null;

    const bestBid = bids.length ? parseFloat(bids[0].price) : null;
    const bestAsk = asks.length ? parseFloat(asks[0].price) : null;
    const midPrice =
      bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : (bestBid ?? bestAsk);
    if (!(midPrice > 0)) return null;

    let sourceReserve = 0;
    let destReserve = 0;
    for (const bid of bids) {
      const amount = parseFloat(bid.amount);
      destReserve += amount;
      sourceReserve += amount / parseFloat(bid.price);
    }
    for (const ask of asks) {
      const amount = parseFloat(ask.amount);
      sourceReserve += amount;
      destReserve += amount * parseFloat(ask.price);
    }

    return {
      kind: 'orderbook',
      id: 'orderbook',
      midPrice,
      sourceReserve,
      destReserve,
      valueInDest: destReserve + sourceReserve * midPrice,
    };
  }

  /** Normalise a Horizon liquidity pool record into a price source. */
  poolSource(record, source, dest) {
    const reserves = record.reserves ?? [];
    if (reserves.length !== 2) return null;

    const find = (asset) =>
      reserves.find((r) => r.asset === (asset.isNative() ? 'native' : `${asset.getCode()}:${asset.getIssuer()}`));
    const src = find(source);
    const dst = find(dest);
    if (!src || !dst) return null;

    const sourceReserve = parseFloat(src.amount);
    const destReserve = parseFloat(dst.amount);
    if (!(sourceReserve > 0) || !(destReserve > 0)) return null;

    const midPrice = destReserve / sourceReserve;
    return {
      kind: 'pool',
      id: record.id,
      midPrice,
      sourceReserve,
      destReserve,
      valueInDest: destReserve + sourceReserve * midPrice,
    };
  }

  /**
   * Liquidity-weighted average price across sources. Each source is weighted by
   * sqrt(sourceReserve * destReserve); sources below MIN_POOL_LIQUIDITY_USD (when
   * the destination asset has a USD rate) or below MIN_RELATIVE_LIQUIDITY of the
   * deepest source are excluded so thin/manipulated pools can't skew the price.
   * @param {Array<object>} sources - Output of {@link getPriceSources}
   * @param {import('@stellar/stellar-sdk').Asset} dest - Destination asset, used for USD valuation
   * @returns {Promise<number|null>} Weighted mid price, or null if no source qualifies
   */
  async computeLiquidityWeightedRate(sources, dest) {
    if (sources.length === 0) return null;

    let eligible = sources.map((s) => ({ ...s, weight: Math.sqrt(s.sourceReserve * s.destReserve) }));

    if (MIN_POOL_LIQUIDITY_USD > 0) {
      const destCode = dest.isNative() ? 'XLM' : dest.getCode();
      const destUsd = await getFiatRate(destCode, 'USD').catch(() => null);
      if (destUsd != null) {
        eligible = eligible.filter((s) => {
          const keep = s.valueInDest * destUsd >= MIN_POOL_LIQUIDITY_USD;
          if (!keep) {
            logger.info('assetConverter.source.excluded', {
              kind: s.kind,
              id: s.id,
              reason: 'below_min_liquidity_usd',
              liquidityUsd: s.valueInDest * destUsd,
              midPrice: s.midPrice,
            });
          }
          return keep;
        });
      } else {
        logger.debug('assetConverter.usdValuation.unavailable', { destCode });
      }
    }

    const maxWeight = Math.max(0, ...eligible.map((s) => s.weight));
    eligible = eligible.filter((s) => s.weight >= maxWeight * MIN_RELATIVE_LIQUIDITY);

    const totalWeight = eligible.reduce((sum, s) => sum + s.weight, 0);
    if (!(totalWeight > 0)) return null;

    return eligible.reduce((sum, s) => sum + s.midPrice * s.weight, 0) / totalWeight;
  }

  /**
   * Quote the destination amount for converting `amount` of `sourceAsset` to `destAsset`,
   * using the current cached liquidity-weighted rate.
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
