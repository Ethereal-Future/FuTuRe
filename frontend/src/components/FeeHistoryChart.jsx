import { useState, useEffect } from 'react';
import apiClient from '../api/client.js';
import { Charts } from './Charts.jsx';
import { formatAssetAmount } from '../utils/formatAmount';

/**
 * Display 24-hour base-fee history chart with current and recommended fee annotations
 */
export function FeeHistoryChart() {
  const [feeHistory, setFeeHistory] = useState([]);
  const [currentFee, setCurrentFee] = useState(null);
  const [recommendedFee, setRecommendedFee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchFeeHistory = async () => {
    try {
      setError('');
      const { data } = await apiClient.get('/api/stellar/fee-history');

      if (data.history && data.history.length > 0) {
        setFeeHistory(data.history);
        setCurrentFee(data.currentFee);
        setRecommendedFee(data.recommendedFee);
        setLastUpdate(new Date());
      }
    } catch (err) {
      setError('Failed to fetch fee history. Please try again later.');
      console.error('Fee history fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeeHistory();

    // Refresh every 60 seconds
    const interval = setInterval(fetchFeeHistory, 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <p>Loading fee history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 20, color: '#ef4444' }}>
        <p>{error}</p>
        <button onClick={fetchFeeHistory} style={{ marginTop: 10, cursor: 'pointer' }}>
          Retry
        </button>
      </div>
    );
  }

  // Transform data for chart
  const chartData = feeHistory.map((point) => ({
    time: new Date(point.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
    baseFee: point.baseFee,
    timestamp: point.timestamp,
  }));

  // Get min/max for better chart scaling
  const fees = feeHistory.map((h) => h.baseFee);
  const minFee = Math.min(...fees);
  const maxFee = Math.max(...fees);
  const avgFee = fees.reduce((a, b) => a + b, 0) / fees.length;

  return (
    <section className="section" aria-labelledby="fee-heading">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 id="fee-heading">Stellar Base Fee (24h History)</h2>
        <div style={{ fontSize: '0.85rem', color: '#666' }}>
          {lastUpdate && <span>Updated: {lastUpdate.toLocaleTimeString()}</span>}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            padding: 12,
            backgroundColor: '#f3f4f6',
            borderRadius: 6,
            textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 4px 0', fontSize: '0.85rem', color: '#666' }}>Current Fee</p>
          <p style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>
            {formatAssetAmount(currentFee / 10000000)} XLM
          </p>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#888' }}>
            {formatAssetAmount(currentFee, { maximumFractionDigits: 0 })} stroops
          </p>
        </div>

        <div
          style={{
            padding: 12,
            backgroundColor: '#dbeafe',
            borderRadius: 6,
            textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 4px 0', fontSize: '0.85rem', color: '#666' }}>Recommended</p>
          <p style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>
            {formatAssetAmount(recommendedFee / 10000000)} XLM
          </p>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#888' }}>
            {formatAssetAmount(recommendedFee, { maximumFractionDigits: 0 })} stroops
          </p>
        </div>

        <div
          style={{
            padding: 12,
            backgroundColor: '#f3f4f6',
            borderRadius: 6,
            textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 4px 0', fontSize: '0.85rem', color: '#666' }}>Min (24h)</p>
          <p style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>
            {formatAssetAmount(minFee / 10000000)} XLM
          </p>
        </div>

        <div
          style={{
            padding: 12,
            backgroundColor: '#f3f4f6',
            borderRadius: 6,
            textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 4px 0', fontSize: '0.85rem', color: '#666' }}>Max (24h)</p>
          <p style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>
            {formatAssetAmount(maxFee / 10000000)} XLM
          </p>
        </div>

        <div
          style={{
            padding: 12,
            backgroundColor: '#f3f4f6',
            borderRadius: 6,
            textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 4px 0', fontSize: '0.85rem', color: '#666' }}>Avg (24h)</p>
          <p style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>
            {formatAssetAmount(avgFee / 10000000)} XLM
          </p>
        </div>
      </div>

      {chartData.length > 0 && (
        <div
          style={{
            backgroundColor: '#f9fafb',
            borderRadius: 6,
            padding: 16,
            marginBottom: 20,
            minHeight: 300,
          }}
        >
          <Charts
            data={chartData}
            xKey="time"
            yKey="baseFee"
            title="Base Fee Trend (stroops)"
            type="line"
          />
        </div>
      )}

      <div
        style={{
          padding: 12,
          backgroundColor: '#fef3c7',
          borderRadius: 6,
          fontSize: '0.9rem',
        }}
      >
        <p style={{ margin: '0 0 8px 0' }}>
          <strong>💡 Tip:</strong> Use the recommended fee for normal transactions. Increase the fee
          during high network congestion to expedite your transaction.
        </p>
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>
          Chart updates every 60 seconds. Fees are shown in stroops (1 XLM = 10,000,000 stroops).
        </p>
      </div>
    </section>
  );
}
