import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const STATUS_BADGE = {
  ACTIVE:    { label: 'Active',    color: '#22c55e' },
  PAUSED:    { label: 'Paused',    color: '#f59e0b' },
  CANCELLED: { label: 'Cancelled', color: '#6b7280' },
  COMPLETED: { label: 'Completed', color: '#3b82f6' },
  FAILED:    { label: 'Failed',    color: '#ef4444' },
};

function StatusBadge({ status }) {
  const { label, color } = STATUS_BADGE[status] ?? { label: status, color: '#6b7280' };
  return (
    <span style={{ background: color, color: '#fff', borderRadius: 4, padding: '1px 7px', fontSize: '0.75rem', fontWeight: 600 }}>
      {label}
    </span>
  );
}

export function StreamPayment({ publicKey }) {
  const [streams, setStreams] = useState([]);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ recipientPublicKey: '', rateAmount: '', intervalSeconds: '60', endTime: '' });
  const [formError, setFormError] = useState(null);
  const [creating, setCreating] = useState(false);

  const fetchStreams = useCallback(async () => {
    setLoadingStreams(true);
    try {
      const { data } = await axios.get('/api/streaming', { params: { senderPublicKey: publicKey } });
      setStreams(data);
    } catch (e) {
      setError(e?.response?.data?.error ?? e.message);
    } finally {
      setLoadingStreams(false);
    }
  }, [publicKey]);

  useEffect(() => { fetchStreams(); }, [fetchStreams]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (!form.recipientPublicKey || !form.rateAmount) {
      setFormError('Recipient and rate are required.');
      return;
    }
    setCreating(true);
    try {
      await axios.post('/api/streaming', {
        senderPublicKey: publicKey,
        recipientPublicKey: form.recipientPublicKey,
        rateAmount: parseFloat(form.rateAmount),
        intervalSeconds: parseInt(form.intervalSeconds, 10),
        assetCode: 'XLM',
        endTime: form.endTime || undefined,
      });
      setForm({ recipientPublicKey: '', rateAmount: '', intervalSeconds: '60', endTime: '' });
      setShowForm(false);
      fetchStreams();
    } catch (e) {
      setFormError(e?.response?.data?.error ?? e?.response?.data?.errors?.[0]?.msg ?? e.message);
    } finally {
      setCreating(false);
    }
  };

  const streamAction = async (id, action) => {
    setActionLoading(`${id}-${action}`);
    try {
      await axios.post(`/api/streaming/${id}/${action}`);
      fetchStreams();
    } catch (e) {
      setError(e?.response?.data?.error ?? e.message);
    } finally {
      setActionLoading('');
    }
  };

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  return (
    <section className="section" aria-labelledby="stream-heading">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 id="stream-heading" style={{ margin: 0 }}>Stream Payments</h2>
        <button type="button" onClick={() => setShowForm(s => !s)} style={{ fontSize: '0.875rem' }}>
          {showForm ? 'Cancel' : '+ New Stream'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="input-wrap">
            <label htmlFor="stream-recipient" className="sr-only">Recipient public key</label>
            <input
              id="stream-recipient"
              type="text"
              placeholder="Recipient Public Key"
              value={form.recipientPublicKey}
              onChange={set('recipientPublicKey')}
              autoComplete="off"
              required
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="input-wrap" style={{ flex: 1 }}>
              <label htmlFor="stream-rate" className="sr-only">Rate per interval (XLM)</label>
              <input
                id="stream-rate"
                type="number"
                min="0.0000001"
                step="any"
                placeholder="Rate (XLM / interval)"
                value={form.rateAmount}
                onChange={set('rateAmount')}
                required
              />
            </div>
            <div className="input-wrap" style={{ flex: 1 }}>
              <label htmlFor="stream-interval" className="sr-only">Interval in seconds</label>
              <input
                id="stream-interval"
                type="number"
                min="10"
                step="1"
                placeholder="Interval (seconds)"
                value={form.intervalSeconds}
                onChange={set('intervalSeconds')}
              />
            </div>
          </div>
          <div className="input-wrap">
            <label htmlFor="stream-end" className="sr-only">End date (optional)</label>
            <input
              id="stream-end"
              type="datetime-local"
              value={form.endTime}
              onChange={set('endTime')}
              aria-label="Stream end date (optional)"
            />
          </div>
          {formError && <p className="field-error" role="alert">{formError}</p>}
          <button type="submit" disabled={creating} aria-busy={creating}>
            {creating ? 'Creating…' : 'Create Stream'}
          </button>
        </form>
      )}

      {error && <p className="field-error" role="alert">{error}</p>}

      {loadingStreams ? (
        <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>Loading streams…</p>
      ) : streams.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>No streams yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {streams.map(s => (
            <li key={s.id} style={{ background: 'var(--surface)', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'monospace' }}>
                  → {s.recipient?.publicKey?.slice(0, 8)}…{s.recipient?.publicKey?.slice(-4)}
                </span>
                <StatusBadge status={s.status} />
              </div>
              <div style={{ fontSize: '0.875rem', marginBottom: 6 }}>
                <strong>{s.rateAmount} {s.assetCode}</strong> every {s.intervalSeconds}s
                {s.endTime && <span style={{ color: 'var(--muted)' }}> · ends {new Date(s.endTime).toLocaleDateString()}</span>}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: 8 }}>
                Streamed: <strong>{parseFloat(s.totalStreamed).toFixed(7)} {s.assetCode}</strong>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {s.status === 'ACTIVE' && (
                  <button
                    type="button"
                    className="btn-clear"
                    style={{ fontSize: '0.8rem', padding: '3px 10px' }}
                    onClick={() => streamAction(s.id, 'pause')}
                    disabled={actionLoading === `${s.id}-pause`}
                    aria-label={`Pause stream to ${s.recipient?.publicKey?.slice(0, 8)}`}
                  >
                    {actionLoading === `${s.id}-pause` ? '…' : 'Pause'}
                  </button>
                )}
                {s.status === 'PAUSED' && (
                  <button
                    type="button"
                    style={{ fontSize: '0.8rem', padding: '3px 10px' }}
                    onClick={() => streamAction(s.id, 'resume')}
                    disabled={actionLoading === `${s.id}-resume`}
                    aria-label={`Resume stream to ${s.recipient?.publicKey?.slice(0, 8)}`}
                  >
                    {actionLoading === `${s.id}-resume` ? '…' : 'Resume'}
                  </button>
                )}
                {(s.status === 'ACTIVE' || s.status === 'PAUSED') && (
                  <button
                    type="button"
                    className="btn-clear"
                    style={{ fontSize: '0.8rem', padding: '3px 10px', background: '#ef4444', color: '#fff' }}
                    onClick={() => streamAction(s.id, 'cancel')}
                    disabled={actionLoading === `${s.id}-cancel`}
                    aria-label={`Cancel stream to ${s.recipient?.publicKey?.slice(0, 8)}`}
                  >
                    {actionLoading === `${s.id}-cancel` ? '…' : 'Cancel'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
