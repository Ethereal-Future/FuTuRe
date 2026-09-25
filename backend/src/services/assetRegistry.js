import * as StellarSdk from '@stellar/stellar-sdk';
import logger from '../config/logger.js';

const TOML_TIMEOUT_MS = 10_000;

function parseTomlField(toml, field) {
  const match = String(toml).match(new RegExp(`^\\s*${field}\\s*=\\s*["']([^"']+)["']`, 'mi'));
  return match?.[1]?.trim() || null;
}

function parseCurrencyDeclaration(toml, code, issuer) {
  return String(toml).split(/\[\[CURRENCIES\]\]/i).slice(1).some((block) =>
    parseTomlField(block, 'code') === code && parseTomlField(block, 'issuer') === issuer
  );
}

function decodeSignature(value) {
  if (!value) return null;
  if (/^[0-9a-f]{128}$/i.test(value)) return Buffer.from(value, 'hex');
  try { return Buffer.from(value, 'base64'); } catch { return null; }
}

function canonicalToml(toml) {
  return String(toml).split('\n')
    .filter((line) => !/^\s*(SIGNATURE|SIGNATURES)\s*=/.test(line))
    .join('\n').trim();
}

/**
 * Asset Registry Service for managing Stellar assets
 */
class AssetRegistryService {
  /**
   * @param {string} horizonUrl - Horizon server URL to connect to
   */
  constructor(horizonUrl) {
    this.server = new StellarSdk.Horizon.Server(horizonUrl);
    this.assets = new Map();
    this.priceCache = new Map();
    this.priceCacheTTL = 60000; // 1 minute
  }

  /**
   * Register a new asset in the in-memory registry after validating it exists on-chain.
   * @param {object} assetData
   * @param {string} assetData.code - Asset code
   * @param {string} assetData.issuer - Issuer public key
   * @param {string} [assetData.name] - Display name (defaults to `code`)
   * @param {string} [assetData.description]
   * @param {string} [assetData.image]
   * @param {string} [assetData.website]
   * @returns {Promise<object>} The registered asset record
   * @throws {Error} If the asset does not exist on the Stellar network
   */
  async registerAsset(assetData) {
    const { code, issuer, name, description, image, website } = assetData;

    // Validate asset exists on Stellar network
    const isValid = await this.validateAsset(code, issuer);
    if (!isValid) {
      throw new Error('Asset not found on Stellar network');
    }
    const domainVerification = await this.verifyIssuerDomain(code, issuer);
    if (!domainVerification.verified) {
      throw new Error(`Asset issuer domain verification failed: ${domainVerification.reason}`);
    }

    const asset = {
      code,
      issuer,
      name: name || code,
      description: description || '',
      image: image || '',
      website: website || '',
      verified: true,
      issuerDomain: domainVerification.homeDomain,
      domainVerified: true,
      registeredAt: new Date(),
      metadata: {}
    };

    this.assets.set(`${code}:${issuer}`, asset);
    return asset;
  }

  /**
   * Verify reciprocal SEP-1 issuer/domain links and the TOML detached signature.
   * @param {string} code - Asset code
   * @param {string} issuer - Issuer public key
   * @returns {Promise<{verified: boolean, homeDomain?: string, reason?: string}>}
   */
  async verifyIssuerDomain(code, issuer) {
    try {
      const account = await this.server.loadAccount(issuer);
      const homeDomain = account.home_domain;
      if (!homeDomain) return { verified: false, reason: 'issuer has no HOME_DOMAIN' };
      const response = await this.fetchToml(homeDomain);
      const toml = await response.text();
      const signingKey = parseTomlField(toml, 'SIGNING_KEY');
      if (signingKey !== issuer) return { verified: false, reason: 'SIGNING_KEY does not match issuer' };
      if (!parseCurrencyDeclaration(toml, code, issuer)) {
        return { verified: false, reason: 'stellar.toml does not declare the issuer asset' };
      }
      const signature = decodeSignature(parseTomlField(toml, 'SIGNATURE'));
      if (!signature || signature.length !== 64) {
        return { verified: false, reason: 'stellar.toml has no valid detached signature' };
      }
      const verified = StellarSdk.Keypair.fromPublicKey(signingKey).verify(
        Buffer.from(canonicalToml(toml)), signature,
      );
      return verified ? { verified: true, homeDomain } : { verified: false, reason: 'stellar.toml signature is invalid' };
    } catch (error) {
      logger.warn('assetRegistry.verifyIssuerDomain.failed', { code, issuer, error: error.message });
      return { verified: false, reason: 'issuer domain could not be verified' };
    }
  }

  async fetchToml(homeDomain) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TOML_TIMEOUT_MS);
    try {
      const response = await fetch(`https://${homeDomain}/.well-known/stellar.toml`, {
        signal: controller.signal,
        headers: { accept: 'text/plain' },
      });
      if (!response.ok) throw new Error(`stellar.toml returned ${response.status}`);
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Check whether an asset code/issuer pair exists on the Stellar network.
   * @param {string} code - Asset code
   * @param {string} issuer - Issuer public key
   * @returns {Promise<boolean>} True if the asset is found (false on lookup error too)
   */
  async validateAsset(code, issuer) {
    try {
      const assets = await this.server.assets()
        .forCode(code)
        .forIssuer(issuer)
        .limit(1)
        .call();

      return assets.records.length > 0;
    } catch (error) {
      logger.error('assetRegistry.validateAsset.failed', { code, issuer, error: error.message });
      return false;
    }
  }

  /**
   * List assets from the Stellar network's public asset directory.
   * @param {object} [filters={}]
   * @param {string} [filters.code] - Filter by asset code
   * @param {string} [filters.issuer] - Filter by issuer public key
   * @param {number} [filters.limit=20] - Max records to return
   * @returns {Promise<Array<{code: string, issuer: string, type: string, numAccounts: number, amount: string, flags: object}>>} Matching assets
   * @throws {Error} If the Horizon query fails
   */
  async discoverAssets(filters = {}) {
    try {
      let query = this.server.assets();

      if (filters.code) {
        query = query.forCode(filters.code);
      }
      if (filters.issuer) {
        query = query.forIssuer(filters.issuer);
      }

      query = query.limit(filters.limit || 20);

      const response = await query.call();
      return response.records.map(record => ({
        code: record.asset_code,
        issuer: record.asset_issuer,
        type: record.asset_type,
        numAccounts: record.num_accounts,
        amount: record.amount,
        flags: record.flags
      }));
    } catch (error) {
      logger.error('assetRegistry.discoverAssets.failed', { filters, error: error.message });
      throw error;
    }
  }

  /**
   * Look up a registered asset's record.
   * @param {string} code - Asset code
   * @param {string} issuer - Issuer public key
   * @returns {object|undefined} The registered asset, or undefined if not registered
   */
  getAsset(code, issuer) {
    return this.assets.get(`${code}:${issuer}`);
  }

  /**
   * List all registered assets.
   * @returns {object[]} All registered asset records
   */
  getAllAssets() {
    return Array.from(this.assets.values());
  }

  /**
   * Merge additional metadata into a registered asset.
   * @param {string} code - Asset code
   * @param {string} issuer - Issuer public key
   * @param {object} metadata - Fields to shallow-merge into the asset's existing metadata
   * @returns {object} The updated asset record
   * @throws {Error} If the asset is not registered
   */
  updateAssetMetadata(code, issuer, metadata) {
    const key = `${code}:${issuer}`;
    const asset = this.assets.get(key);
    
    if (!asset) {
      throw new Error('Asset not found');
    }

    asset.metadata = { ...asset.metadata, ...metadata };
    asset.updatedAt = new Date();
    this.assets.set(key, asset);
    
    return asset;
  }

  /**
   * Mark a registered asset as manually verified (or unverified).
   * @param {string} code - Asset code
   * @param {string} issuer - Issuer public key
   * @param {boolean} [verified=true] - Verification flag to set
   * @returns {object} The updated asset record
   * @throws {Error} If the asset is not registered
   */
  verifyAsset(code, issuer, verified = true) {
    const key = `${code}:${issuer}`;
    const asset = this.assets.get(key);
    
    if (!asset) {
      throw new Error('Asset not found');
    }

    asset.verified = verified;
    asset.verifiedAt = new Date();
    this.assets.set(key, asset);
    
    return asset;
  }

  /**
   * Compute (and cache for `priceCacheTTL` ms) an asset's average price from its 10 most recent trades.
   * @param {string} code - Asset code
   * @param {string} issuer - Issuer public key
   * @param {string} [baseAsset='XLM'] - Quote asset, "XLM" or "CODE:ISSUER"
   * @returns {Promise<number|null>} Average trade price, or null if no recent trades or on error
   */
  async trackAssetPrice(code, issuer, baseAsset = 'XLM') {
    const key = `${code}:${issuer}:${baseAsset}`;
    const cached = this.priceCache.get(key);

    if (cached && Date.now() - cached.timestamp < this.priceCacheTTL) {
      return cached.price;
    }

    try {
      // Get recent trades to calculate price
      const asset = new StellarSdk.Asset(code, issuer);
      const base = baseAsset === 'XLM' 
        ? StellarSdk.Asset.native() 
        : new StellarSdk.Asset(baseAsset.split(':')[0], baseAsset.split(':')[1]);

      const trades = await this.server.trades()
        .forAssetPair(base, asset)
        .limit(10)
        .order('desc')
        .call();

      if (trades.records.length === 0) {
        return null;
      }

      // Calculate average price from recent trades
      const avgPrice = trades.records.reduce((sum, trade) => {
        return sum + parseFloat(trade.price.n) / parseFloat(trade.price.d);
      }, 0) / trades.records.length;

      const priceData = {
        price: avgPrice,
        timestamp: Date.now(),
        volume24h: trades.records.reduce((sum, t) => sum + parseFloat(t.base_amount), 0)
      };

      this.priceCache.set(key, priceData);
      return avgPrice;
    } catch (error) {
      logger.error('assetRegistry.trackAssetPrice.failed', { code, issuer, baseAsset, error: error.message });
      return null;
    }
  }

  /**
   * Read the last cached price for an asset without triggering a fresh fetch.
   * @param {string} code - Asset code
   * @param {string} issuer - Issuer public key
   * @param {string} [baseAsset='XLM'] - Quote asset, "XLM" or "CODE:ISSUER"
   * @returns {number|null} Cached price, or null if nothing is cached (regardless of TTL)
   */
  getAssetPrice(code, issuer, baseAsset = 'XLM') {
    const key = `${code}:${issuer}:${baseAsset}`;
    const cached = this.priceCache.get(key);
    return cached ? cached.price : null;
  }

  /**
   * Remove an asset from the registry.
   * @param {string} code - Asset code
   * @param {string} issuer - Issuer public key
   * @returns {boolean} True if the asset was present and removed
   */
  removeAsset(code, issuer) {
    const key = `${code}:${issuer}`;
    return this.assets.delete(key);
  }

  /**
   * Search registered assets by code, name, or issuer (case-insensitive substring match).
   * @param {string} query - Search term
   * @returns {object[]} Matching asset records
   */
  searchAssets(query) {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.assets.values()).filter(asset => 
      asset.code.toLowerCase().includes(lowerQuery) ||
      asset.name.toLowerCase().includes(lowerQuery) ||
      asset.issuer.toLowerCase().includes(lowerQuery)
    );
  }
}

export default AssetRegistryService;
