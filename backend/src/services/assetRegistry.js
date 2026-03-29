import * as StellarSdk from '@stellar/stellar-sdk';

/**
 * Asset Registry Service for managing Stellar assets
 */
class AssetRegistryService {
  constructor(horizonUrl) {
    this.server = new StellarSdk.Horizon.Server(horizonUrl);
    this.assets = new Map();
    this.priceCache = new Map();
    this.priceCacheTTL = 60000; // 1 minute
  }

  /**
   * Register a new asset
   */
  async registerAsset(assetData) {
    const { code, issuer, name, description, image, website } = assetData;

    // Validate asset exists on Stellar network
    const isValid = await this.validateAsset(code, issuer);
    if (!isValid) {
      throw new Error('Asset not found on Stellar network');
    }

    const asset = {
      code,
      issuer,
      name: name || code,
      description: description || '',
      image: image || '',
      website: website || '',
      verified: false,
      registeredAt: new Date(),
      metadata: {}
    };

    this.assets.set(`${code}:${issuer}`, asset);
    return asset;
  }

  /**
   * Validate asset exists on Stellar network
   */
  async validateAsset(code, issuer) {
    try {
      const asset = new StellarSdk.Asset(code, issuer);
      const assets = await this.server.assets()
        .forCode(code)
        .forIssuer(issuer)
        .limit(1)
        .call();

      return assets.records.length > 0;
    } catch (error) {
      console.error('Asset validation error:', error);
      return false;
    }
  }

  /**
   * Discover assets from Stellar network
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
      console.error('Asset discovery error:', error);
      throw error;
    }
  }

  /**
   * Get asset details
   */
  getAsset(code, issuer) {
    return this.assets.get(`${code}:${issuer}`);
  }

  /**
   * Get all registered assets
   */
  getAllAssets() {
    return Array.from(this.assets.values());
  }

  /**
   * Update asset metadata
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
   * Verify asset (manual verification process)
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
   * Track asset price
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
      console.error('Price tracking error:', error);
      return null;
    }
  }

  /**
   * Get asset price
   */
  getAssetPrice(code, issuer, baseAsset = 'XLM') {
    const key = `${code}:${issuer}:${baseAsset}`;
    const cached = this.priceCache.get(key);
    return cached ? cached.price : null;
  }

  /**
   * Remove asset from registry
   */
  removeAsset(code, issuer) {
    const key = `${code}:${issuer}`;
    return this.assets.delete(key);
  }

  /**
   * Search assets
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
