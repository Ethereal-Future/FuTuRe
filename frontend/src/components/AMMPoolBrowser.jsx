import { useState, useEffect } from 'react';
import axios from 'axios';

/**
 * Read-only AMM pool browser: lists pools, liquidity, price, and arbitrage opportunities.
 */
export function AMMPoolBrowser() {
  const [pools, setPools] = useState([]);
  const [arbitrage, setArbitrage] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchPools = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get('/api/stellar/amm/pools');
      setPools(data.pools ?? []);

      // Detect arbitrage for each unique asset pair
      const pairs = new Set();
      const opps = [];
      for (const pool of data.pools ?? []) {
        const key = [pool.assetA, pool.assetB].sort().join(':');
        if (!pairs.has(key)) {
          pairs.add(key);
          const res = await axios.get(`/api/stellar/amm/arbitrage/${pool.assetA}/${pool.assetB}`);
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
        <h2 id="amm-heading">AMM Pools</h2>
        <button type="button" onClick={fetchPools} disabled={loading} aria-label="Refresh AMM pools">
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>

      {error && <p role="alert" style={{ color: '#ef4444' }}>{error}</p>}

      {pools.length === 0 && !loading && (
        <p style={{ color: '#888' }}>No pools registered yet.</p>
      )}

      {pools.length > 0 && (
        <div role="list" aria-label="AMM pools">
          {pools.map((pool) => (
            <div key={pool.poolId} role="listitem" className="section" style={{ marginBottom: 8 }}>
              <strong>{pool.assetA} / {pool.assetB}</strong>
              <span style={{ marginLeft: 8, fontSize: '0.8rem', color: '#888' }}>({pool.poolId})</span>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 4, fontSize: '0.9rem' }}>
                <span>Reserve A: <strong>{pool.reserveA.toFixed(4)}</strong></span>
                <span>Reserve B: <strong>{pool.reserveB.toFixed(4)}</strong></span>
                <span>Liquidity: <strong>{pool.liquidity.toFixed(4)}</strong></span>
                <span>Price: <strong>{pool.midPrice.toFixed(6)}</strong> {pool.assetB}/{pool.assetA}</span>
                <span>Fee: <strong>{pool.feeBps} bps</strong></span>
              </div>
            </div>
          ))}
        </div>
      )}

      {arbitrage.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h3 style={{ fontSize: '1rem' }}>⚡ Arbitrage Opportunities</h3>
          {arbitrage.map((opp, i) => (
            <div key={i} style={{ fontSize: '0.9rem', padding: '6px 0', borderBottom: '1px solid #eee' }}>
              Buy on <strong>{opp.buyPool}</strong> → Sell on <strong>{opp.sellPool}</strong>
              {' '}— Spread: <strong>{(opp.spreadPct * 100).toFixed(3)}%</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
