/**
 * Asset Portfolio Management Service
 */
class AssetPortfolioService {
  constructor(assetRegistry, trustlineManager) {
    this.assetRegistry = assetRegistry;
    this.trustlineManager = trustlineManager;
    this.portfolios = new Map();
  }

  /**
   * Get portfolio for an account
   */
  async getPortfolio(publicKey) {
    try {
      const trustlines = await this.trustlineManager.getTrustlines(publicKey);
      const portfolio = {
        publicKey,
        assets: [],
        totalValue: 0,
        lastUpdated: new Date()
      };

      for (const trustline of trustlines) {
        const asset = this.assetRegistry.getAsset(trustline.assetCode, trustline.assetIssuer);
        const price = await this.assetRegistry.trackAssetPrice(
          trustline.assetCode,
          trustline.assetIssuer
        );

        const balance = parseFloat(trustline.balance);
        const value = price ? balance * price : 0;

        portfolio.assets.push({
          code: trustline.assetCode,
          issuer: trustline.assetIssuer,
          balance: balance,
          price: price,
          value: value,
          limit: trustline.limit,
          metadata: asset || {}
        });

        portfolio.totalValue += value;
      }

      this.portfolios.set(publicKey, portfolio);
      return portfolio;
    } catch (error) {
      console.error('Get portfolio error:', error);
      throw error;
    }
  }

  /**
   * Get portfolio allocation
   */
  async getPortfolioAllocation(publicKey) {
    const portfolio = await this.getPortfolio(publicKey);
    
    return portfolio.assets.map(asset => ({
      code: asset.code,
      issuer: asset.issuer,
      value: asset.value,
      percentage: portfolio.totalValue > 0 
        ? (asset.value / portfolio.totalValue * 100).toFixed(2)
        : 0
    }));
  }

  /**
   * Calculate portfolio performance
   */
  async calculatePerformance(publicKey, historicalData = []) {
    const currentPortfolio = await this.getPortfolio(publicKey);
    
    if (historicalData.length === 0) {
      return {
        currentValue: currentPortfolio.totalValue,
        change: 0,
        changePercent: 0
      };
    }

    const previousValue = historicalData[0].totalValue;
    const change = currentPortfolio.totalValue - previousValue;
    const changePercent = previousValue > 0 
      ? (change / previousValue * 100).toFixed(2)
      : 0;

    return {
      currentValue: currentPortfolio.totalValue,
      previousValue,
      change,
      changePercent
    };
  }

  /**
   * Get asset diversity score
   */
  async getDiversityScore(publicKey) {
    const portfolio = await this.getPortfolio(publicKey);
    
    if (portfolio.assets.length === 0) {
      return 0;
    }

    // Calculate Herfindahl-Hirschman Index (HHI)
    const hhi = portfolio.assets.reduce((sum, asset) => {
      const share = portfolio.totalValue > 0 
        ? asset.value / portfolio.totalValue 
        : 0;
      return sum + (share * share);
    }, 0);

    // Convert to diversity score (0-100, higher is more diverse)
    const diversityScore = (1 - hhi) * 100;
    
    return {
      score: diversityScore.toFixed(2),
      numAssets: portfolio.assets.length,
      interpretation: this.interpretDiversityScore(diversityScore)
    };
  }

  /**
   * Interpret diversity score
   */
  interpretDiversityScore(score) {
    if (score >= 80) return 'Highly Diversified';
    if (score >= 60) return 'Well Diversified';
    if (score >= 40) return 'Moderately Diversified';
    if (score >= 20) return 'Poorly Diversified';
    return 'Not Diversified';
  }

  /**
   * Get portfolio summary
   */
  async getPortfolioSummary(publicKey) {
    const portfolio = await this.getPortfolio(publicKey);
    const allocation = await this.getPortfolioAllocation(publicKey);
    const diversity = await this.getDiversityScore(publicKey);

    return {
      totalAssets: portfolio.assets.length,
      totalValue: portfolio.totalValue,
      topAssets: allocation.slice(0, 5),
      diversity,
      lastUpdated: portfolio.lastUpdated
    };
  }

  /**
   * Suggest portfolio rebalancing
   */
  async suggestRebalancing(publicKey, targetAllocation = {}) {
    const portfolio = await this.getPortfolio(publicKey);
    const currentAllocation = await this.getPortfolioAllocation(publicKey);

    const suggestions = [];

    for (const [assetKey, targetPercent] of Object.entries(targetAllocation)) {
      const [code, issuer] = assetKey.split(':');
      const current = currentAllocation.find(
        a => a.code === code && a.issuer === issuer
      );

      const currentPercent = current ? parseFloat(current.percentage) : 0;
      const diff = targetPercent - currentPercent;

      if (Math.abs(diff) > 5) { // 5% threshold
        suggestions.push({
          asset: { code, issuer },
          currentPercent,
          targetPercent,
          action: diff > 0 ? 'BUY' : 'SELL',
          amount: Math.abs(diff * portfolio.totalValue / 100)
        });
      }
    }

    return suggestions;
  }

  /**
   * Export portfolio data
   */
  async exportPortfolio(publicKey, format = 'json') {
    const portfolio = await this.getPortfolio(publicKey);
    const summary = await this.getPortfolioSummary(publicKey);

    const data = {
      portfolio,
      summary,
      exportedAt: new Date()
    };

    if (format === 'csv') {
      return this.convertToCSV(data);
    }

    return data;
  }

  /**
   * Convert portfolio to CSV
   */
  convertToCSV(data) {
    const headers = ['Asset Code', 'Issuer', 'Balance', 'Price', 'Value', 'Percentage'];
    const rows = data.portfolio.assets.map(asset => [
      asset.code,
      asset.issuer,
      asset.balance,
      asset.price || 'N/A',
      asset.value,
      data.portfolio.totalValue > 0 
        ? (asset.value / data.portfolio.totalValue * 100).toFixed(2) + '%'
        : '0%'
    ]);

    return [headers, ...rows]
      .map(row => row.join(','))
      .join('\n');
  }
}

export default AssetPortfolioService;
