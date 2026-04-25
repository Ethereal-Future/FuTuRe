import { useState, useEffect } from 'react';
import axios from 'axios';

const STEPS = ['phrase', 'contacts', 'recover'];

/**
 * Account recovery flow:
 *  1. Set up recovery phrase
 *  2. Add trusted contacts
 *  3. Initiate recovery by entering the phrase
 */
export function AccountRecovery() {
  const [step, setStep] = useState('phrase');
  const [phraseStatus, setPhraseStatus] = useState(null); // null | true | false
  const [phrase, setPhrase] = useState('');
  const [contacts, setContacts] = useState([]);
  const [newContact, setNewContact] = useState({ name: '', email: '' });
  const [recoverUserId, setRecoverUserId] = useState('');
  const [recoverPhrase, setRecoverPhrase] = useState('');
  const [requestId, setRequestId] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Check if phrase is already configured
  useEffect(() => {
    axios.get('/api/recovery/phrase/status')
      .then(({ data }) => setPhraseStatus(data.configured))
      .catch(() => {});
    axios.get('/api/recovery/contacts')
      .then(({ data }) => setContacts(data.contacts ?? []))
      .catch(() => {});
  }, []);

  const call = async (fn) => {
    setLoading(true); setError(''); setMsg('');
    try { await fn(); } catch (err) { setError(err.response?.data?.error ?? err.message); }
    finally { setLoading(false); }
  };

  // Step 1: Setup phrase
  const setupPhrase = () => call(async () => {
    const { data } = await axios.post('/api/recovery/phrase/setup');
    setPhrase(data.phrase);
    setPhraseStatus(true);
    setMsg(data.warning);
  });

  // Step 2: Add contact
  const addContact = () => call(async () => {
    const { data } = await axios.post('/api/recovery/contacts', newContact);
    setContacts((c) => [...c, data.contact]);
    setNewContact({ name: '', email: '' });
  });

  const removeContact = (id) => call(async () => {
    await axios.delete(`/api/recovery/contacts/${id}`);
    setContacts((c) => c.filter((x) => x.id !== id));
  });

  // Step 3: Initiate recovery
  const initiateRecovery = () => call(async () => {
    const { data } = await axios.post('/api/recovery/initiate', { userId: recoverUserId, method: 'phrase' });
    setRequestId(data.requestId);
    setMsg(data.message);
  });

  const verifyPhrase = () => call(async () => {
    const { data } = await axios.post(`/api/recovery/${requestId}/verify-phrase`, { phrase: recoverPhrase });
    setMsg(`Phrase verified. Status: ${data.status}. Recovery unlocks after time-lock.`);
  });

  return (
    <section className="section" aria-labelledby="recovery-heading">
      <h2 id="recovery-heading">Account Recovery</h2>

      {/* Tab navigation */}
      <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[['phrase', '1. Recovery Phrase'], ['contacts', '2. Trusted Contacts'], ['recover', '3. Initiate Recovery']].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={step === id}
            onClick={() => { setStep(id); setError(''); setMsg(''); }}
            style={{ fontWeight: step === id ? 'bold' : 'normal', textDecoration: step === id ? 'underline' : 'none' }}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p role="alert" style={{ color: '#ef4444' }}>{error}</p>}
      {msg && <p role="status" style={{ color: '#22c55e' }}>{msg}</p>}

      {/* Step 1: Recovery Phrase */}
      {step === 'phrase' && (
        <div role="tabpanel" aria-labelledby="tab-phrase">
          {phraseStatus === true && !phrase && (
            <p>✅ Recovery phrase is configured.</p>
          )}
          {phrase && (
            <div style={{ background: '#fef9c3', padding: 12, borderRadius: 6, marginBottom: 12 }}>
              <strong>Your recovery phrase (shown once):</strong>
              <p style={{ fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 4 }}>{phrase}</p>
            </div>
          )}
          {!phraseStatus && (
            <button type="button" onClick={setupPhrase} disabled={loading} aria-busy={loading}>
              {loading ? '…' : 'Generate Recovery Phrase'}
            </button>
          )}
        </div>
      )}

      {/* Step 2: Trusted Contacts */}
      {step === 'contacts' && (
        <div role="tabpanel" aria-labelledby="tab-contacts">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <input
              type="text"
              placeholder="Name"
              value={newContact.name}
              onChange={(e) => setNewContact((c) => ({ ...c, name: e.target.value }))}
              aria-label="Contact name"
            />
            <input
              type="email"
              placeholder="Email"
              value={newContact.email}
              onChange={(e) => setNewContact((c) => ({ ...c, email: e.target.value }))}
              aria-label="Contact email"
            />
            <button type="button" onClick={addContact} disabled={loading || !newContact.name || !newContact.email}>
              {loading ? '…' : 'Add Contact'}
            </button>
          </div>
          {contacts.length === 0 && <p style={{ color: '#888' }}>No trusted contacts yet.</p>}
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {contacts.map((c) => (
              <li key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #eee' }}>
                <span>{c.name} — {c.email} {c.confirmed && '✅'}</span>
                <button type="button" onClick={() => removeContact(c.id)} aria-label={`Remove ${c.name}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}>✕</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Step 3: Initiate Recovery */}
      {step === 'recover' && (
        <div role="tabpanel" aria-labelledby="tab-recover">
          {!requestId ? (
            <>
              <p style={{ color: '#888', fontSize: '0.9rem' }}>Enter your user ID to start recovery. A 24h time-lock will be applied.</p>
              <input
                type="text"
                placeholder="Your User ID"
                value={recoverUserId}
                onChange={(e) => setRecoverUserId(e.target.value)}
                aria-label="User ID for recovery"
                style={{ marginBottom: 8, display: 'block' }}
              />
              <button type="button" onClick={initiateRecovery} disabled={loading || !recoverUserId} aria-busy={loading}>
                {loading ? '…' : 'Start Recovery'}
              </button>
            </>
          ) : (
            <>
              <p>Request ID: <code>{requestId}</code></p>
              <input
                type="text"
                placeholder="Enter your recovery phrase"
                value={recoverPhrase}
                onChange={(e) => setRecoverPhrase(e.target.value)}
                aria-label="Recovery phrase"
                style={{ marginBottom: 8, display: 'block', width: '100%' }}
              />
              <button type="button" onClick={verifyPhrase} disabled={loading || !recoverPhrase} aria-busy={loading}>
                {loading ? '…' : 'Verify Phrase'}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
