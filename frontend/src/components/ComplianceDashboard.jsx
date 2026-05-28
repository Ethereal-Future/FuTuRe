import { useState, useEffect } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';

const SEVERITY_COLORS = {
  HIGH: '#ef4444',
  MEDIUM: '#f59e0b',
  LOW: '#22c55e',
};

export function ComplianceDashboard({ onClose }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [reviewingId, setReviewingId] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');

  useEffect(() => {
    loadAlerts();
  }, [page]);

  const loadAlerts = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get(`/api/compliance/aml/alerts?page=${page}&limit=20`);
      setAlerts(data.alerts);
      setPagination(data.pagination);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load AML alerts');
    } finally {
      setLoading(false);
    }
  };

  const markAsReviewed = async (alertId) => {
    try {
      await axios.patch(`/api/compliance/aml/alerts/${alertId}/review`, {
        notes: reviewNotes,
      });
      setReviewingId(null);
      setReviewNotes('');
      loadAlerts();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to mark alert as reviewed');
    }
  };

  return (
    <div
      className="replay-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="compliance-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="replay-modal" style={{ maxWidth: 900, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 id="compliance-title" style={{ margin: 0 }}>AML Compliance Dashboard</h2>
          <button type="button" className="qr-close" onClick={onClose} aria-label="Close dashboard">
            ✕
          </button>
        </div>

        {error && (
          <div role="alert" style={{ padding: 12, background: '#fee', color: '#c00', borderRadius: 4, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {loading && <p>Loading alerts...</p>}

        {!loading && alerts.length === 0 && (
          <p style={{ color: 'var(--text-muted, #64748b)' }}>No AML alerts found.</p>
        )}

        {!loading && alerts.length > 0 && (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Severity</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Risk Score</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Rule</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Description</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Transaction</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>User</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Date</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((alert) => (
                    <tr key={alert.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <span
                          style={{
                            background: SEVERITY_COLORS[alert.severity] || '#94a3b8',
                            color: '#fff',
                            padding: '2px 8px',
                            borderRadius: 4,
                            fontSize: '0.75rem',
                            fontWeight: 600,
                          }}
                        >
                          {alert.severity}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{ fontWeight: 600 }}>{alert.riskScore}</span>
                        <span style={{ color: 'var(--text-muted, #64748b)', marginLeft: 4, fontSize: '0.8rem' }}>
                          ({alert.riskLevel})
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        {alert.ruleId}
                      </td>
                      <td style={{ padding: '8px 12px', maxWidth: 200 }}>{alert.description}</td>
                      <td style={{ padding: '8px 12px' }}>
                        {alert.transaction && (
                          <div style={{ fontSize: '0.8rem' }}>
                            <div style={{ fontFamily: 'monospace' }}>
                              {alert.transaction.hash.slice(0, 8)}...
                            </div>
                            <div style={{ color: 'var(--text-muted, #64748b)' }}>
                              {alert.transaction.amount} {alert.transaction.assetCode}
                            </div>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {alert.user?.publicKey.slice(0, 8)}...
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: '0.8rem' }}>
                        {new Date(alert.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {reviewingId === alert.id ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <input
                              type="text"
                              placeholder="Review notes..."
                              value={reviewNotes}
                              onChange={(e) => setReviewNotes(e.target.value)}
                              style={{ fontSize: '0.8rem', padding: '4px 8px' }}
                            />
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button
                                type="button"
                                onClick={() => markAsReviewed(alert.id)}
                                style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setReviewingId(null);
                                  setReviewNotes('');
                                }}
                                style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setReviewingId(alert.id)}
                            style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                          >
                            Review
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pagination && pagination.pages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16, alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setPage(page - 1)}
                  disabled={page === 1}
                  style={{ fontSize: '0.85rem' }}
                >
                  Previous
                </button>
                <span style={{ fontSize: '0.85rem' }}>
                  Page {pagination.page} of {pagination.pages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(page + 1)}
                  disabled={page === pagination.pages}
                  style={{ fontSize: '0.85rem' }}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
