import { useState, useEffect } from 'react';
import apiClient from '../api/client.js';
import { Charts } from './Charts.jsx';
import { formatAssetAmount } from '../utils/formatAmount';

/**
 * Display real persisted base-fee history chart.
 * Shows however many real snapshots exist and surfaces an
 * "insufficient history" notice when fewer than the full window are available.
 */
export function FeeHistoryChart() {
  const [feeHistory, setFeeHistory]           = useState([]);
  const [currentFee, setCurrentFee]           = useState(null);
  const [recommendedFee, setRecommendedFee]   = useState(null);
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState('');
  const [lastUpdate, setLastUpdate]           = useState(null);
  const [insufficientHistory, setInsufficient] = useState(false);
  const [snapshotCount, setSnapshotCount]     = useState(0);

  const fetchFeeHistory = async () => {
    try {
      setError('');
      const { data } = await apiClient.get('/api/stellar/fee-history');

      setInsufficient(data.insufficientHistory ?? false);
      setSnapshotCount(data.snapshotCount ?? 0);

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
      <div className="fee-history-loading">
        <p>Loading fee history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fee-history-error">
        <p>{error}</p>
        <button onClick={fetchFeeHistory}>Retry</button>
      </div>
    );
  }

  // No snapshots at all — freshly deployed
  if (feeHistory.length === 0) {
    return (
      <div className="fee-history-empty">
        <h2>Stellar Base Fee History</h2>
        <p>
          No fee history yet. Snapshots are collected every 5 minutes —
          check back shortly.
        </p>
        <button onClick={fetchFeeHistory}>Refresh</button>
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
  const fees   = feeHistory.map((h) => h.baseFee);
  const minFee = Math.min(...fees);
  const maxFee = Math.max(...fees);
  const avgFee = fees.reduce((a, b) => a + b, 0) / fees.length;

  // Human-readable window label based on real data span
  const windowHours = feeHistory.length > 1
    ? Math.round(
        (new Date(feeHistory[feeHistory.length - 1].timestamp) -
          new Date(feeHistory[0].timestamp)) /
          (1000 * 60 * 60)
      )
    : 0;
  const windowLabel = windowHours >= 1 ? `${windowHours}h History` : 'Recent History';

  return (
    <div className="fee-history-chart">
      <div className="fee-history-header">
        <h2>Stellar Base Fee ({windowLabel})</h2>
        {lastUpdate && (
          <span className="last-update">
            Updated: {lastUpdate.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Insufficient history notice — shown until a full 24h of snapshots accumulates */}
      {insufficientHistory && (
        <div className="fee-history-notice" role="status" aria-live="polite">
          <span aria-hidden="true">ℹ️</span>{' '}
          Showing {snapshotCount} real snapshot{snapshotCount !== 1 ? 's' : ''}.
          A full 24-hour history will be available after the service has been
          running for 24 hours.
        </div>
      )}

      <div className="fee-stats-grid">
        <div className="fee-stat">
          <span className="fee-stat-label">Current Fee</span>
          <span className="fee-stat-value">
            {formatAssetAmount(currentFee / 10000000)} XLM
          </span>
          <span className="fee-stat-sub">
            {formatAssetAmount(currentFee, { maximumFractionDigits: 0 })} stroops
          </span>
        </div>

        <div className="fee-stat recommended">
          <span className="fee-stat-label">Recommended</span>
          <span className="fee-stat-value">
            {formatAssetAmount(recommendedFee / 10000000)} XLM
          </span>
          <span className="fee-stat-sub">
            {formatAssetAmount(recommendedFee, { maximumFractionDigits: 0 })} stroops
          </span>
        </div>

        <div className="fee-stat">
          <span className="fee-stat-label">Min ({windowLabel})</span>
          <span className="fee-stat-value">
            {formatAssetAmount(minFee / 10000000)} XLM
          </span>
        </div>

        <div className="fee-stat">
          <span className="fee-stat-label">Max ({windowLabel})</span>
          <span className="fee-stat-value">
            {formatAssetAmount(maxFee / 10000000)} XLM
          </span>
        </div>

        <div className="fee-stat">
          <span className="fee-stat-label">Avg ({windowLabel})</span>
          <span className="fee-stat-value">
            {formatAssetAmount(avgFee / 10000000)} XLM
          </span>
        </div>
      </div>

      {chartData.length > 0 && (
        <div className="fee-chart-container">
          <Charts data={chartData} />
        </div>
      )}

      <div className="fee-history-footer">
        <p>
          <strong>💡 Tip:</strong> Use the recommended fee for normal transactions.
          Increase the fee during high network congestion to expedite your transaction.
        </p>
        <p>
          Chart updates every 60 seconds. Fees are shown in stroops
          (1 XLM = 10,000,000 stroops).
        </p>
      </div>
    </div>
  );
}