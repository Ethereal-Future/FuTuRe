import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import apiClient from '../api/client.js';
import { formatAssetAmount } from '../utils/formatAmount';

/**
 * Read-only AMM pool browser: lists pools, liquidity, price, and arbitrage opportunities.
 */
export function AMMPoolBrowser() {
  const { t } = useTranslation();
  const [pools, setPools] = useState([]);
  const [arbitrage, setArbitrage] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchPools = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await apiClient.get('/api/stellar/amm/pools');
      setPools(data.pools ?? []);

      // Detect arbitrage for each unique asset pair
      const pairs = new Set();
      const opps = [];
      for (const pool of data.pools ?? []) {
        const key = [pool.assetA, pool.assetB].sort().join(':');
        if (!pairs.has(key)) {
          pairs.add(key);
          const res = await apiClient.get(`/api/stellar/amm/arbitrage/${pool.assetA}/${pool.assetB}`);
          opps.push(...(res.data.opportunities ?? []));
        }
      }
      setArbitrage(opps);
    } catch (err) {
      setError(err.response?.data?.error ?? err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPools(); }, []);

  return (
    <section className="section" aria-labelledby="amm-heading">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 id="amm-heading">{t('ammPoolBrowser.title')}</h2>
        <button type="button" onClick={fetchPools} disabled={loading} aria-label={t('ammPoolBrowser.refresh')}>
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>

      {error && <p role="alert" style={{ color: '#ef4444' }}>{error}</p>}

      {pools.length === 0 && !loading && (
        <p style={{ color: '#888' }}>{t('ammPoolBrowser.empty')}</p>
      )}

      {pools.length > 0 && (
        <div role="list" aria-label={t('ammPoolBrowser.listAriaLabel')}>
          {pools.map((pool) => (
            <div key={pool.poolId} role="listitem" className="section" style={{ marginBottom: 8 }}>
              <strong>{pool.assetA} / {pool.assetB}</strong>
              <span style={{ marginLeft: 8, fontSize: '0.8rem', color: '#888' }}>({pool.poolId})</span>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 4, fontSize: '0.9rem' }}>
                <span>{t('ammPoolBrowser.reserveA')} <strong>{formatAssetAmount(pool.reserveA, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</strong></span>
                <span>{t('ammPoolBrowser.reserveB')} <strong>{formatAssetAmount(pool.reserveB, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</strong></span>
                <span>{t('ammPoolBrowser.liquidity')} <strong>{formatAssetAmount(pool.liquidity, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</strong></span>
                <span>{t('ammPoolBrowser.price')} <strong>{formatAssetAmount(pool.midPrice, { minimumFractionDigits: 6, maximumFractionDigits: 6 })}</strong> {pool.assetB}/{pool.assetA}</span>
                <span>{t('ammPoolBrowser.fee')} <strong>{pool.feeBps} {t('ammPoolBrowser.bps')}</strong></span>
              </div>
            </div>
          ))}
        </div>
      )}

      {arbitrage.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h3 style={{ fontSize: '1rem' }}>{t('ammPoolBrowser.arbitrageTitle')}</h3>
          {arbitrage.map((opp, i) => (
            <div key={i} style={{ fontSize: '0.9rem', padding: '6px 0', borderBottom: '1px solid #eee' }}>
              {t('ammPoolBrowser.buyOn')} <strong>{opp.buyPool}</strong> {t('ammPoolBrowser.sellOn')} <strong>{opp.sellPool}</strong>
              {' '}{t('ammPoolBrowser.spread')} <strong>{(opp.spreadPct * 100).toFixed(3)}%</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
