import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const WEBHOOK_EVENTS = [
  { value: 'payment_sent', label: 'payment_sent' },
  { value: 'payment_received', label: 'payment_received' },
];

export function WebhookManager({ accountId }) {
  const [webhooks, setWebhooks] = useState([]);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [selectedEvents, setSelectedEvents] = useState(WEBHOOK_EVENTS.map((e) => e.value));
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canSubmit = useMemo(() => {
    return url.trim().length > 0 && selectedEvents.length > 0 && !submitting;
  }, [url, selectedEvents, submitting]);

  const loadWebhooks = async () => {
    if (!accountId) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get('/api/webhooks', { params: { accountId } });
      setWebhooks(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.response?.data?.error ?? 'Failed to load webhooks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWebhooks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const toggleEvent = (eventName) => {
    setSelectedEvents((prev) => {
      if (prev.includes(eventName)) return prev.filter((e) => e !== eventName);
      return [...prev, eventName];
    });
  };

  const registerWebhook = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError('');
    setNotice('');

    try {
      await axios.post('/api/webhooks', {
        url: url.trim(),
        accountId,
        events: selectedEvents,
        secret: secret.trim() || undefined,
      });
      setUrl('');
      setSecret('');
      setSelectedEvents(WEBHOOK_EVENTS.map((item) => item.value));
      setNotice('Webhook registered successfully.');
      await loadWebhooks();
    } catch (err) {
      const message = err?.response?.data?.errors?.[0]?.msg ?? err?.response?.data?.error ?? 'Failed to register webhook';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const removeWebhook = async (id) => {
    setError('');
    setNotice('');
    try {
      await axios.delete(`/api/webhooks/${id}`);
      setNotice('Webhook deleted.');
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Failed to delete webhook');
    }
  };

  return (
    <section aria-labelledby="webhooks-title">
      <p id="webhooks-title" style={{ fontWeight: 600, marginBottom: 4 }}>Webhooks</p>
      <p style={{ margin: '0 0 12px', color: 'var(--text-muted, #64748b)', fontSize: '0.9rem' }}>
        Register webhook URLs to receive account event notifications.
      </p>

      <form onSubmit={registerWebhook} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <label htmlFor="webhook-url" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
          Webhook URL
        </label>
        <input
          id="webhook-url"
          type="url"
          value={url}
          onChange={(evt) => setUrl(evt.target.value)}
          placeholder="https://example.com/webhooks/stellar"
          required
          style={{ marginBottom: 8 }}
        />

        <label htmlFor="webhook-secret" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
          Signing Secret (optional)
        </label>
        <input
          id="webhook-secret"
          type="text"
          value={secret}
          onChange={(evt) => setSecret(evt.target.value)}
          placeholder="leave blank to auto-generate"
          style={{ marginBottom: 8 }}
        />

        <fieldset style={{ border: 'none', padding: 0, marginBottom: 10 }}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>Events</legend>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {WEBHOOK_EVENTS.map((eventItem) => (
              <label key={eventItem.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selectedEvents.includes(eventItem.value)}
                  onChange={() => toggleEvent(eventItem.value)}
                  style={{ width: 'auto', minHeight: 'unset', margin: 0 }}
                />
                {eventItem.label}
              </label>
            ))}
          </div>
        </fieldset>

        <button type="submit" disabled={!canSubmit}>
          {submitting ? 'Registering…' : 'Register webhook'}
        </button>
      </form>

      {error && <p role="alert" style={{ color: '#ef4444', marginBottom: 8 }}>{error}</p>}
      {notice && <p role="status" style={{ color: '#16a34a', marginBottom: 8 }}>{notice}</p>}

      {loading ? (
        <p>Loading registered webhooks…</p>
      ) : webhooks.length === 0 ? (
        <p style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.9rem', marginBottom: 0 }}>
          No webhooks registered for this account.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {webhooks.map((webhook) => (
            <li key={webhook.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
              <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{webhook.url}</div>
              <div style={{ marginTop: 4, fontSize: '0.85rem', color: 'var(--text-muted, #64748b)' }}>
                Events: {(webhook.events ?? []).join(', ')}
              </div>
              <div style={{ marginTop: 4, fontSize: '0.8rem', color: 'var(--text-muted, #64748b)' }}>
                Added: {webhook.createdAt ? new Date(webhook.createdAt).toLocaleString() : 'Unknown'}
              </div>
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn-clear"
                  onClick={() => removeWebhook(webhook.id)}
                  style={{ width: 'auto' }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}