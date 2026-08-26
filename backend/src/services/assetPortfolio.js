/**
 * Asset Portfolio Management Service
 */
import logger from '../config/logger.js';

class AssetPortfolioService {
  /**
   * @param {object} assetRegistry - Asset registry providing `getAsset` and `trackAssetPrice`
   * @param {object} trustlineManager - Trustline manager providing `getTrustlines`
   */
  constructor(assetRegistry, trustlineManager) {
    this.assetRegistry = assetRegistry;
    this.trustlineManager = trustlineManager;
    this.portfolios = new Map();
  }

  /**
   * Build (and cache in-memory) an account's asset portfolio from its trustlines and current prices.
   * @param {string} publicKey - Stellar public key of the account
   * @returns {Promise<{publicKey: string, assets: Array<{code: string, issuer: string, balance: number, price: number|null, value: number, limit: string, metadata: object}>, totalValue: number, lastUpdated: Date}>} The account's portfolio
   * @throws {Error} If trustlines cannot be fetched
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
      logger.error('assetPortfolio.getPortfolio.failed', { publicKey, error: error.message });
      throw error;
    }
  }

  /**
   * Get each held asset's share of the portfolio's total value.
   * @param {string} publicKey - Stellar public key of the account
   * @returns {Promise<Array<{code: string, issuer: string, value: number, percentage: string|number}>>} Per-asset value and percentage of total
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
   * Compare the current portfolio value against a historical snapshot.
   * @param {string} publicKey - Stellar public key of the account
   * @param {Array<{totalValue: number}>} [historicalData=[]] - Historical portfolio snapshots, most recent first; only the first entry is used as the baseline
   * @returns {Promise<{currentValue: number, previousValue?: number, change: number, changePercent: string|number}>} Value change since the baseline snapshot
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
   * Compute a portfolio diversity score using the Herfindahl-Hirschman Index (HHI).
   * @param {string} publicKey - Stellar public key of the account
   * @returns {Promise<number|{score: string, numAssets: number, interpretation: string}>} `0` if the portfolio is empty; otherwise the score (0-100, higher is more diverse), asset count, and a human-readable interpretation
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
   * Map a numeric diversity score to a human-readable label.
   * @param {number} score - Diversity score, 0-100
   * @returns {string} Label from "Not Diversified" to "Highly Diversified"
   */
  interpretDiversityScore(score) {
    if (score >= 80) return 'Highly Diversified';
    if (score >= 60) return 'Well Diversified';
    if (score >= 40) return 'Moderately Diversified';
    if (score >= 20) return 'Poorly Diversified';
    return 'Not Diversified';
  }

  /**
   * Get a condensed portfolio summary: totals, top holdings, and diversity score.
   * @param {string} publicKey - Stellar public key of the account
   * @returns {Promise<{totalAssets: number, totalValue: number, topAssets: Array<object>, diversity: object|number, lastUpdated: Date}>} Portfolio summary
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
   * Suggest buy/sell adjustments to move the current allocation toward a target allocation.
   * Assets whose current vs. target percentage differ by more than 5 points are flagged.
   * @param {string} publicKey - Stellar public key of the account
   * @param {Object<string, number>} [targetAllocation={}] - Target percentages keyed by "CODE:ISSUER"
   * @returns {Promise<Array<{asset: {code: string, issuer: string}, currentPercent: number, targetPercent: number, action: 'BUY'|'SELL', amount: number}>>} Rebalancing suggestions
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
   * Export a portfolio (with summary) as JSON or CSV.
   * @param {string} publicKey - Stellar public key of the account
   * @param {'json'|'csv'} [format='json'] - Output format
   * @returns {Promise<object|string>} The portfolio+summary object, or a CSV string when `format` is "csv"
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
   * Serialize a portfolio export to CSV.
   * @param {{portfolio: {assets: Array<object>, totalValue: number}}} data - Export payload from {@link exportPortfolio}
   * @returns {string} CSV text with a header row and one row per asset
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
