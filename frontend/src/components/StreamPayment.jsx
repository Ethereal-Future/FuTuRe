import { useState, useEffect, useCallback, useMemo } from 'react';
import apiClient from '../api/client.js';
import { formatAssetAmount } from '../utils/formatAmount';

const STATUS_BADGE = {
  ACTIVE: { label: 'Active', color: '#22c55e' },
  PAUSED: { label: 'Paused', color: '#f59e0b' },
  CANCELLED: { label: 'Cancelled', color: '#6b7280' },
  COMPLETED: { label: 'Completed', color: '#3b82f6' },
  FAILED: { label: 'Failed', color: '#ef4444' },
};

const INTERVAL_PRESETS = [
  { label: 'Daily', days: 1 },
  { label: 'Weekly', days: 7 },
  { label: 'Monthly', days: 30 },
];

const SUPPORTED_ASSETS = [
  { code: 'XLM', label: 'XLM (native)', issuer: null },
  {
    code: 'USDC',
    label: 'USDC (stablecoin)',
    issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
];

function getAssetMeta(code) {
  return SUPPORTED_ASSETS.find((a) => a.code === code) ?? SUPPORTED_ASSETS[0];
}
=======

function StatusBadge({ status }) {
  const { label, color } = STATUS_BADGE[status] ?? { label: status, color: '#6b7280' };
  return (
    <span
      style={{
        background: color,
        color: '#fff',
        borderRadius: 4,
        padding: '1px 7px',
        fontSize: '0.75rem',
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

function computeStreamSummary(rateAmount, intervalDays, endDate) {
  const rate = parseFloat(rateAmount);
  const days = parseInt(intervalDays, 10);
  if (!rate || !days || !endDate) return null;

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  const totalDays = Math.max(0, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
  const paymentCount = Math.floor(totalDays / days) + 1;
  const totalAmount = formatAssetAmount(rate * paymentCount);

  return { totalAmount, totalXLM: totalAmount, totalDays, paymentCount };
}

export function StreamPayment({ publicKey }) {
  const [streams, setStreams] = useState([]);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    recipientPublicKey: '',
    rateAmount: '',
    intervalDays: '7',
    endDate: '',
    assetCode: 'XLM',
  });
  const [formError, setFormError] = useState(null);
  const [creating, setCreating] = useState(false);

  const summary = useMemo(
    () => computeStreamSummary(form.rateAmount, form.intervalDays, form.endDate),
    [form.rateAmount, form.intervalDays, form.endDate],
  );

  const fetchStreams = useCallback(async () => {
    setLoadingStreams(true);
    try {
      const { data } = await apiClient.get('/api/streaming', {
        params: { senderPublicKey: publicKey },
      });
      setStreams(data);
    } catch (err) {
      setError(err?.response?.data?.error ?? err.message);
    } finally {
      setLoadingStreams(false);
    }
  }, [publicKey]);

  useEffect(() => {
    fetchStreams();
  }, [fetchStreams]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (!form.recipientPublicKey || !form.rateAmount) {
      setFormError('Recipient and amount are required.');
      return;
    }
    if (!publicKey) {
      setFormError('Connect your wallet to set up a standing order.');
      return;
    }
    setCreating(true);
    try {
      const intervalSeconds = parseInt(form.intervalDays, 10) * 24 * 60 * 60;
      const asset = getAssetMeta(form.assetCode);
      const endTime = form.endDate ? new Date(form.endDate).toISOString() : undefined;

      // Request a session-scoped signature from the wallet (e.g. Freighter).
      // The secret key never leaves the wallet and is never read from or sent
      // over the network in plaintext.
      const { data: challenge } = await apiClient.post('/api/streaming/authorize/challenge', {
        senderPublicKey: publicKey,
        recipientPublicKey: form.recipientPublicKey,
        rateAmount: parseFloat(form.rateAmount),
        intervalSeconds,
        assetCode: asset.code,
        assetIssuer: asset.issuer ?? undefined,
        endTime,
      });

      if (!window.freighterApi?.signMessage) {
        throw new Error('A Stellar wallet (e.g. Freighter) is required to authorize payments.');
      }
      const signed = await window.freighterApi.signMessage(challenge.challenge, {
        accountToSign: publicKey,
      });
      const signature = typeof signed === 'string' ? signed : signed?.signedMessage;
      if (!signature) {
        throw new Error('Payment authorization was not signed.');
      }

      await apiClient.post('/api/streaming', {
        senderPublicKey: publicKey,
        recipientPublicKey: form.recipientPublicKey,
        rateAmount: parseFloat(form.rateAmount),
        intervalSeconds,
        assetCode: asset.code,
        assetIssuer: asset.issuer ?? undefined,
        endTime,
        challenge: challenge.challenge,
        signature,
      });
      setForm({
        recipientPublicKey: '',
        rateAmount: '',
        intervalDays: '7',
        endDate: '',
        assetCode: 'XLM',
      });
      setShowForm(false);
      fetchStreams();
    } catch (err) {
      setFormError(
        err?.response?.data?.error ?? err?.response?.data?.errors?.[0]?.msg ?? err.message,
      );
    } finally {
      setCreating(false);
    }
  };

  const streamAction = async (id, action) => {
    setActionLoading(`${id}-${action}`);
    try {
      await apiClient.post(`/api/streaming/${id}/${action}`);
      fetchStreams();
    } catch (err) {
      setError(err?.response?.data?.error ?? err.message);
    } finally {
      setActionLoading('');
    }
  };

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const intervalLabel =
    INTERVAL_PRESETS.find((p) => String(p.days) === form.intervalDays)?.label ??
    `every ${form.intervalDays} days`;

  const selectedAsset = getAssetMeta(form.assetCode);

  return (
    <section className="section" aria-labelledby="stream-heading">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <h2 id="stream-heading" style={{ margin: 0 }}>
          Recurring Payments
        </h2>
        <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          style={{ fontSize: '0.875rem' }}
        >
          {showForm ? 'Cancel' : '+ New Standing Order'}
        </button>
      </div>

      <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginTop: 0, marginBottom: 12 }}>
        Set up automatic payments — like a standing order at your bank.
      </p>

      {showForm && (
        <form
          onSubmit={handleCreate}
          style={{
            marginBottom: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            background: 'var(--surface)',
            padding: 16,
            borderRadius: 8,
          }}
        >
          <div className="input-wrap">
            <label
              htmlFor="stream-recipient"
              style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
            >
              Send to
            </label>
            <input
              id="stream-recipient"
              type="text"
              placeholder="Recipient public key"
              value={form.recipientPublicKey}
              onChange={set('recipientPublicKey')}
              autoComplete="off"
              required
            />
          </div>

          <div className="input-wrap">
            <label
              htmlFor="stream-asset"
              style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
            >
              Asset
            </label>
            <select id="stream-asset" value={form.assetCode} onChange={set('assetCode')}>
              {SUPPORTED_ASSETS.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="input-wrap" style={{ flex: '1 1 120px' }}>
              <label
                htmlFor="stream-rate"
                style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
              >
                Amount ({selectedAsset.code})
              </label>
              <input
                id="stream-rate"
                type="number"
                min="0.0000001"
                step="any"
                placeholder="10"
                value={form.rateAmount}
                onChange={set('rateAmount')}
                required
              />
            </div>
            <span style={{ padding: '8px 0', fontWeight: 600, color: 'var(--muted)' }}>every</span>
            <div className="input-wrap" style={{ flex: '1 1 140px' }}>
              <label
                htmlFor="stream-interval"
                style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
              >
                Frequency
              </label>
              <select id="stream-interval" value={form.intervalDays} onChange={set('intervalDays')}>
                {INTERVAL_PRESETS.map((p) => (
                  <option key={p.days} value={String(p.days)}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted, #64748b)' }}>
            Send{' '}
            <strong>
              {form.rateAmount || '—'} {selectedAsset.code}
            </strong>{' '}
            {intervalLabel.toLowerCase()}
          </p>

          <div className="input-wrap">
            <label
              htmlFor="stream-end"
              style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
            >
              End date
            </label>
            <input
              id="stream-end"
              type="date"
              value={form.endDate}
              onChange={set('endDate')}
              min={new Date().toISOString().split('T')[0]}
              aria-label="Standing order end date"
            />
          </div>

          {summary && (
            <div
              role="status"
              style={{
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: 6,
                padding: '10px 14px',
                fontSize: '0.9rem',
              }}
            >
              <strong>Summary:</strong> Total to be sent:{' '}
              <strong>
                {summary.totalAmount} {selectedAsset.code}
              </strong>{' '}
              over <strong>{summary.totalDays} days</strong> ({summary.paymentCount} payments)
            </div>
          )}

          {formError && (
            <p className="field-error" role="alert">
              {formError}
            </p>
          )}
          <button type="submit" disabled={creating} aria-busy={creating}>
            {creating ? 'Setting up…' : 'Set Up Standing Order'}
          </button>
        </form>
      )}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {loadingStreams ? (
        <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>Loading standing orders…</p>
      ) : streams.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>No recurring payments yet.</p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {streams.map((s) => {
            const days = Math.round(s.intervalSeconds / (24 * 60 * 60));
            return (
              <li
                key={s.id}
                style={{ background: 'var(--surface)', borderRadius: 8, padding: '10px 14px' }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'monospace' }}
                  >
                    → {s.recipient?.publicKey?.slice(0, 8)}…{s.recipient?.publicKey?.slice(-4)}
                  </span>
                  <StatusBadge status={s.status} />
                </div>
                <div style={{ fontSize: '0.875rem', marginBottom: 6 }}>
                  Send{' '}
                  <strong>
                    {s.rateAmount} {s.assetCode}
                  </strong>{' '}
                  every{' '}
                  <strong>
                    {days || 1} day{days !== 1 ? 's' : ''}
                  </strong>
                  {s.endTime && (
                    <span style={{ color: 'var(--muted)' }}>
                      {' '}
                      · until {new Date(s.endTime).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: 8 }}>
                  Sent so far:{' '}
                  <strong>
                    {formatAssetAmount(s.totalStreamed)} {s.assetCode}
                  </strong>
                  {s.nextPaymentAt && s.status === 'ACTIVE' && (
                    <span> · Next: {new Date(s.nextPaymentAt).toLocaleDateString()}</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {s.status === 'ACTIVE' && (
                    <button
                      type="button"
                      className="btn-clear"
                      style={{ fontSize: '0.8rem', padding: '3px 10px' }}
                      onClick={() => streamAction(s.id, 'pause')}
                      disabled={actionLoading === `${s.id}-pause`}
                      aria-label={`Pause recurring payment to ${s.recipient?.publicKey?.slice(0, 8)}`}
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
                      aria-label={`Resume recurring payment to ${s.recipient?.publicKey?.slice(0, 8)}`}
                    >
                      {actionLoading === `${s.id}-resume` ? '…' : 'Resume'}
                    </button>
                  )}
                  {(s.status === 'ACTIVE' || s.status === 'PAUSED') && (
                    <button
                      type="button"
                      className="btn-clear"
                      style={{
                        fontSize: '0.8rem',
                        padding: '3px 10px',
                        background: '#ef4444',
                        color: '#fff',
                      }}
                      onClick={() => streamAction(s.id, 'cancel')}
                      disabled={actionLoading === `${s.id}-cancel`}
                      aria-label={`Cancel recurring payment to ${s.recipient?.publicKey?.slice(0, 8)}`}
                    >
                      {actionLoading === `${s.id}-cancel` ? '…' : 'Cancel'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export { computeStreamSummary };
