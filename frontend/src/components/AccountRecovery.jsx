import { useState, useEffect } from 'react';
import apiClient from '../api/client.js';
import { motion, AnimatePresence } from 'framer-motion';
import { useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';

const STEPS = ['phrase', 'contacts', 'recover'];

/**
 * Account recovery flow:
 *  1. Set up recovery phrase (mandatory after account creation)
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
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [confirmedWords, setConfirmedWords] = useState(new Set());

  // Check if phrase is already configured
  useEffect(() => {
    apiClient.get('/api/recovery/phrase/status')
      .then(({ data }) => setPhraseStatus(data.configured))
      .catch(() => {});
    apiClient.get('/api/recovery/contacts')
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
    const { data } = await apiClient.post('/api/recovery/phrase/setup');
    setPhrase(data.phrase);
    setPhraseStatus(true);
    setMsg(data.warning);
    setShowBackupModal(true);
  });

  // Generate 3 random word indices to confirm
  const getRandomWords = () => {
    if (!phrase) return [];
    const words = phrase.split(' ');
    const indices = [];
    while (indices.length < 3) {
      const idx = Math.floor(Math.random() * words.length);
      if (!indices.includes(idx)) indices.push(idx);
    }
    return indices.sort((a, b) => a - b);
  };

  const [randomWordIndices, setRandomWordIndices] = useState(() => getRandomWords());

  const handleBackupConfirm = async () => {
    const words = phrase.split(' ');
    const allCorrect = randomWordIndices.every(idx => confirmedWords.has(words[idx]));

    if (!allCorrect) {
      setError('❌ Some words are incorrect. Please check and try again.');
      setConfirmedWords(new Set());
      setRandomWordIndices(getRandomWords());
      return;
    }

    await call(async () => {
      await apiClient.post('/api/recovery/phrase/confirm-backup');
      setMsg('✅ Recovery phrase backup confirmed successfully!');
      setShowBackupModal(false);
      setConfirmedWords(new Set());
    });
  };

  const backupModalRef = useRef(null);
  if (showBackupModal) useFocusTrap(backupModalRef, true);

  // Step 2: Add contact
  const addContact = () => call(async () => {
    const { data } = await apiClient.post('/api/recovery/contacts', newContact);
    setContacts((c) => [...c, data.contact]);
    setNewContact({ name: '', email: '' });
  });

  const removeContact = (id) => call(async () => {
    await apiClient.delete(`/api/recovery/contacts/${id}`);
    setContacts((c) => c.filter((x) => x.id !== id));
  });

  // Step 3: Initiate recovery
  const initiateRecovery = () => call(async () => {
    const { data } = await apiClient.post('/api/recovery/initiate', { userId: recoverUserId, method: 'phrase' });
    setRequestId(data.requestId);
    setMsg(data.message);
  });

  const verifyPhrase = () => call(async () => {
    const { data } = await apiClient.post(`/api/recovery/${requestId}/verify-phrase`, { phrase: recoverPhrase });
    setMsg(`Phrase verified. Status: ${data.status}. Recovery unlocks after time-lock.`);
  });

  return (
    <section className="section" aria-labelledby="recovery-heading">
      <h2 id="recovery-heading">Account Recovery</h2>

      {/* Tab navigation */}
      <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[['phrase', '1. Recovery Phrase'], ['contacts', '2. Trusted Contacts'], ['recover', '3. Initiate Recovery']].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={step === id}
            aria-controls={`panel-${id}`}
            onClick={() => { setStep(id); setError(''); setMsg(''); }}
            style={{ 
              fontWeight: step === id ? 'bold' : 'normal', 
              textDecoration: step === id ? 'underline' : 'none',
              opacity: step === id ? 1 : 0.7 
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <AnimatePresence>
        {error && (
          <motion.p 
            role="alert" 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            style={{ color: '#ef4444', marginBottom: 8 }}
          >
            {error}
          </motion.p>
        )}
        {msg && (
          <motion.p 
            role="status" 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            style={{ color: '#22c55e', marginBottom: 8 }}
          >
            {msg}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Step 1: Recovery Phrase */}
      {step === 'phrase' && (
        <div role="tabpanel" id="panel-phrase" aria-labelledby="tab-phrase">
          {phraseStatus === true && !phrase && (
            <p>✅ Recovery phrase is configured.</p>
          )}
          {phrase && (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }}
              style={{ background: '#fef9c3', padding: 12, borderRadius: 6, marginBottom: 12, border: '2px solid #f59e0b' }}
            >
              <strong>Your recovery phrase (shown once):</strong>
              <p style={{ fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 4, marginBottom: 0, fontSize: 13 }}>
                {phrase}
              </p>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: '#92400e' }}>
                📝 Write this down and store it in a secure location. Do not share with anyone.
              </p>
            </motion.div>
          )}
          {!phraseStatus && (
            <button type="button" onClick={setupPhrase} disabled={loading} aria-busy={loading}>
              {loading ? 'Generating…' : 'Generate Recovery Phrase'}
            </button>
          )}
        </div>
      )}

      {/* Step 2: Trusted Contacts */}
      {step === 'contacts' && (
        <div role="tabpanel" id="panel-contacts" aria-labelledby="tab-contacts">
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
              {loading ? 'Adding…' : 'Add Contact'}
            </button>
          </div>
          {contacts.length === 0 && <p style={{ color: '#888' }}>No trusted contacts yet.</p>}
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {contacts.map((c) => (
              <li key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #eee', alignItems: 'center' }}>
                <span>{c.name} — {c.email} {c.confirmed && '✅'}</span>
                <button 
                  type="button" 
                  onClick={() => removeContact(c.id)} 
                  aria-label={`Remove ${c.name}`} 
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 16 }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Step 3: Initiate Recovery */}
      {step === 'recover' && (
        <div role="tabpanel" id="panel-recover" aria-labelledby="tab-recover">
          {!requestId ? (
            <>
              <p style={{ color: '#888', fontSize: '0.9rem' }}>Enter your user ID to start recovery. A 24h time-lock will be applied.</p>
              <input
                type="text"
                placeholder="Your User ID"
                value={recoverUserId}
                onChange={(e) => setRecoverUserId(e.target.value)}
                aria-label="User ID for recovery"
                style={{ marginBottom: 8, display: 'block', width: '100%' }}
              />
              <button type="button" onClick={initiateRecovery} disabled={loading || !recoverUserId} aria-busy={loading}>
                {loading ? 'Starting…' : 'Start Recovery'}
              </button>
            </>
          ) : (
            <>
              <p>Request ID: <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 3 }}>{requestId}</code></p>
              <input
                type="text"
                placeholder="Enter your recovery phrase"
                value={recoverPhrase}
                onChange={(e) => setRecoverPhrase(e.target.value)}
                aria-label="Recovery phrase"
                style={{ marginBottom: 8, display: 'block', width: '100%' }}
              />
              <button type="button" onClick={verifyPhrase} disabled={loading || !recoverPhrase} aria-busy={loading}>
                {loading ? 'Verifying…' : 'Verify Phrase'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Backup Confirmation Modal */}
      <AnimatePresence>
        {showBackupModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000
            }}
            onClick={() => setShowBackupModal(false)}
          >
            <motion.div
              ref={backupModalRef}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'white',
                borderRadius: 8,
                padding: 20,
                maxWidth: 500,
                width: '90%',
                boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
              }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="backup-modal-title"
            >
              <h3 id="backup-modal-title" style={{ margin: '0 0 12px 0', color: '#dc2626' }}>
                Confirm Recovery Phrase Backup
              </h3>
              <p style={{ color: '#666', marginBottom: 16, fontSize: 13 }}>
                To ensure you've safely backed up your recovery phrase, please confirm these random words:
              </p>

              <div style={{ background: '#fef3c7', padding: 12, borderRadius: 6, marginBottom: 16 }}>
                {randomWordIndices.map((idx) => {
                  const words = phrase.split(' ');
                  const word = words[idx];
                  const isCorrect = confirmedWords.has(word);
                  return (
                    <div key={idx} style={{ marginBottom: 8 }}>
                      <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 600 }}>
                        Word #{idx + 1}:
                      </p>
                      <input
                        type="text"
                        placeholder={`Enter word #${idx + 1}`}
                        value={Array.from(confirmedWords).find(w => words.indexOf(w) === idx) || ''}
                        onChange={(e) => {
                          const val = e.target.value.trim().toLowerCase();
                          const newConfirmed = new Set(confirmedWords);
                          newConfirmed.forEach(w => {
                            if (phrase.split(' ').indexOf(w) === idx) newConfirmed.delete(w);
                          });
                          if (val) newConfirmed.add(val);
                          setConfirmedWords(newConfirmed);
                        }}
                        aria-label={`Confirm word #${idx + 1}`}
                        style={{
                          width: '100%',
                          padding: '8px',
                          borderRadius: 4,
                          border: `2px solid ${isCorrect ? '#10b981' : '#e5e7eb'}`,
                          fontSize: 13
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleBackupConfirm}
                  disabled={loading}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: '#dc2626',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  {loading ? 'Confirming…' : 'Confirm Backup'}
                </button>
                <button
                  onClick={() => setShowBackupModal(false)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: '#e5e7eb',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  Later
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
