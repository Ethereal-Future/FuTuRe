import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { FormField } from './FormField';
import { Spinner } from './Spinner';
import { StatusMessage } from './StatusMessage';

const STATUS_BADGE = {
  PENDING:   { label: 'Pending', color: '#f59e0b' },
  SUBMITTED: { label: 'Submitted', color: '#22c55e' },
  FAILED:    { label: 'Failed', color: '#ef4444' },
  EXPIRED:   { label: 'Expired', color: '#6b7280' },
};

function StatusBadge({ status }) {
  const badge = STATUS_BADGE[status] ?? { label: status, color: '#6b7280' };
  return (
    <span style={{ background: badge.color, color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: '0.75rem', fontWeight: 600 }}>
      {badge.label}
    </span>
  );
}

export function MultiSigTransactions({ publicKey }) {
  const [activeTab, setActiveTab] = useState('setup'); // 'setup', 'build', 'sign', 'pending'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Setup tab
  const [setupForm, setSetupForm] = useState({ sourceSecret: '', signerPublicKey: '', signerWeight: '1', lowThreshold: '1', medThreshold: '1', highThreshold: '1', masterWeight: '1' });
  const [signers, setSigners] = useState([]);

  // Build tab
  const [buildForm, setBuildForm] = useState({ destination: '', amount: '', assetCode: 'XLM' });
  const [builtTx, setBuiltTx] = useState(null);

  // Sign tab
  const [signForm, setSignForm] = useState({ txId: '', signerSecret: '' });
  const [signLoading, setSignLoading] = useState(false);

  // Pending tab
  const [pendingTxs, setPendingTxs] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);

  const fetchCurrentConfig = useCallback(async () => {
    if (!publicKey) return;
    try {
      const { data } = await axios.get(`/api/multisig/account/${publicKey}`);
      setSigners(data.signers || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load config');
    }
  }, [publicKey]);

  const fetchPendingTxs = useCallback(async () => {
    if (!publicKey) return;
    setPendingLoading(true);
    try {
      const { data } = await axios.get(`/api/multisig/transaction/pending/${publicKey}`);
      setPendingTxs(data.transactions || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load pending transactions');
    } finally {
      setPendingLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    fetchCurrentConfig();
  }, [fetchCurrentConfig]);

  const handleSetupMultiSig = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!setupForm.sourceSecret.trim()) {
      setError('Source secret is required to convert your account to multi-sig.');
      setLoading(false);
      return;
    }

    try {
      const newSigner = {
        publicKey: setupForm.signerPublicKey,
        weight: parseInt(setupForm.signerWeight, 10),
      };

      await axios.post('/api/multisig/account/create', {
        sourceSecret: setupForm.sourceSecret,
        signers: [newSigner],
        thresholds: {
          low: parseInt(setupForm.lowThreshold, 10),
          medium: parseInt(setupForm.medThreshold, 10),
          high: parseInt(setupForm.highThreshold, 10),
        },
        masterWeight: parseInt(setupForm.masterWeight, 10),
      });

      setSuccess('Multi-sig account created successfully!');
      setSetupForm({ sourceSecret: '', signerPublicKey: '', signerWeight: '1', lowThreshold: '1', medThreshold: '1', highThreshold: '1', masterWeight: '1' });
      setTimeout(() => setSuccess(null), 4000);
      fetchCurrentConfig();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to create multi-sig account');
    } finally {
      setLoading(false);
    }
  };

  const handleBuildTx = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.post('/api/multisig/transaction/build', {
        sourcePublicKey: publicKey,
        destination: buildForm.destination,
        amount: buildForm.amount,
        assetCode: buildForm.assetCode,
      });
      
      setBuiltTx(data);
      setSuccess('Transaction built! Share the txId with co-signers.');
      setTimeout(() => setSuccess(null), 4000);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to build transaction');
    } finally {
      setLoading(false);
    }
  };

  const handleSignTx = async (e) => {
    e.preventDefault();
    setSignLoading(true);
    setError(null);
    try {
      const { data } = await axios.post('/api/multisig/transaction/sign', {
        txId: signForm.txId,
        signerSecret: signForm.signerSecret,
      });
      
      setSuccess(`Signature added! (${data.totalSignatures} signatures collected)`);
      setSignForm({ txId: '', signerSecret: '' });
      setTimeout(() => setSuccess(null), 4000);
      fetchPendingTxs();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to sign transaction');
    } finally {
      setSignLoading(false);
    }
  };

  const handleSubmitTx = async (txId) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.post('/api/multisig/transaction/submit', { txId });
      setSuccess(`Transaction submitted! Hash: ${data.hash}`);
      setTimeout(() => setSuccess(null), 4000);
      fetchPendingTxs();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to submit transaction');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="section" aria-labelledby="multisig-heading">
      <h2 id="multisig-heading" style={{ marginBottom: 16 }}>Multi-Signature Transactions</h2>

      {error && <StatusMessage type="error" message={error} />}
      {success && <StatusMessage type="success" message={success} />}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
        {['setup', 'build', 'sign', 'pending'].map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => { setActiveTab(tab); if (tab === 'pending') fetchPendingTxs(); }}
            style={{
              padding: '8px 12px',
              border: 'none',
              background: activeTab === tab ? '#2563eb' : 'transparent',
              color: activeTab === tab ? '#fff' : '#666',
              borderBottom: activeTab === tab ? '2px solid #2563eb' : 'none',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '0.9rem',
            }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'setup' && (
          <form key="setup" onSubmit={handleSetupMultiSig} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FormField label="Account Secret Key" required>
              <input
                type="password"
                placeholder="S..."
                value={setupForm.sourceSecret}
                onChange={(e) => setSetupForm({ ...setupForm, sourceSecret: e.target.value })}
                style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
                autoComplete="off"
              />
            </FormField>
            <FormField label="Signer Public Key" required>
              <input
                type="text"
                placeholder="GBRPYHIL2CI3..."
                value={setupForm.signerPublicKey}
                onChange={(e) => setSetupForm({ ...setupForm, signerPublicKey: e.target.value })}
                style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
              />
            </FormField>
            <FormField label="Signer Weight" required>
              <input
                type="number"
                min="0"
                max="255"
                value={setupForm.signerWeight}
                onChange={(e) => setSetupForm({ ...setupForm, signerWeight: e.target.value })}
                style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
              />
            </FormField>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <FormField label="Low Threshold" required>
                <input
                  type="number"
                  min="0"
                  max="255"
                  value={setupForm.lowThreshold}
                  onChange={(e) => setSetupForm({ ...setupForm, lowThreshold: e.target.value })}
                  style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
                />
              </FormField>
              <FormField label="Medium Threshold" required>
                <input
                  type="number"
                  min="0"
                  max="255"
                  value={setupForm.medThreshold}
                  onChange={(e) => setSetupForm({ ...setupForm, medThreshold: e.target.value })}
                  style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
                />
              </FormField>
              <FormField label="High Threshold" required>
                <input
                  type="number"
                  min="0"
                  max="255"
                  value={setupForm.highThreshold}
                  onChange={(e) => setSetupForm({ ...setupForm, highThreshold: e.target.value })}
                  style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
                />
              </FormField>
            </div>
            <button type="submit" disabled={loading} style={{ padding: 10, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              {loading ? <Spinner /> : 'Create Multi-Sig Account'}
            </button>
          </form>
        )}

        {activeTab === 'build' && (
          <form key="build" onSubmit={handleBuildTx} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FormField label="Destination Public Key" required>
              <input
                type="text"
                placeholder="GBRPYHIL2CI3..."
                value={buildForm.destination}
                onChange={(e) => setBuildForm({ ...buildForm, destination: e.target.value })}
                style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
              />
            </FormField>
            <FormField label="Amount (XLM)" required>
              <input
                type="number"
                step="0.01"
                min="0"
                value={buildForm.amount}
                onChange={(e) => setBuildForm({ ...buildForm, amount: e.target.value })}
                style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
              />
            </FormField>
            <FormField label="Asset Code">
              <select
                value={buildForm.assetCode}
                onChange={(e) => setBuildForm({ ...buildForm, assetCode: e.target.value })}
                style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
              >
                <option value="XLM">XLM</option>
                <option value="USDC">USDC</option>
              </select>
            </FormField>
            {builtTx && (
              <div style={{ padding: 12, background: '#f0f9ff', border: '1px solid #bfdbfe', borderRadius: 4 }}>
                <p style={{ fontSize: '0.875rem', margin: '0 0 8px 0' }}><strong>Transaction ID:</strong> <code>{builtTx.txId}</code></p>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(builtTx.txId)}
                  style={{ fontSize: '0.75rem', padding: '4px 8px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}
                >
                  Copy txId
                </button>
              </div>
            )}
            <button type="submit" disabled={loading} style={{ padding: 10, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              {loading ? <Spinner /> : 'Build Transaction'}
            </button>
          </form>
        )}

        {activeTab === 'sign' && (
          <form key="sign" onSubmit={handleSignTx} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FormField label="Transaction ID" required>
              <input
                type="text"
                placeholder="multisig-..."
                value={signForm.txId}
                onChange={(e) => setSignForm({ ...signForm, txId: e.target.value })}
                style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
              />
            </FormField>
            <FormField label="Your Secret Key" required>
              <input
                type="password"
                placeholder="S..."
                value={signForm.signerSecret}
                onChange={(e) => setSignForm({ ...signForm, signerSecret: e.target.value })}
                style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
              />
            </FormField>
            <button type="submit" disabled={signLoading} style={{ padding: 10, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              {signLoading ? <Spinner /> : 'Sign Transaction'}
            </button>
          </form>
        )}

        {activeTab === 'pending' && (
          <div key="pending">
            {pendingLoading ? (
              <Spinner />
            ) : pendingTxs.length === 0 ? (
              <p style={{ color: '#999' }}>No pending transactions.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {pendingTxs.map((tx) => (
                  <div key={tx.txId} style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>→ {tx.destination.slice(0, 12)}...</span>
                      <StatusBadge status={tx.status} />
                    </div>
                    <p style={{ margin: '4px 0', fontSize: '0.875rem' }}><strong>Amount:</strong> {tx.amount} {tx.assetCode}</p>
                    <p style={{ margin: '4px 0', fontSize: '0.875rem' }}><strong>Signatures:</strong> {tx.signatures.length}</p>
                    <p style={{ margin: '4px 0', fontSize: '0.75rem', color: '#666' }}>txId: <code>{tx.txId}</code></p>
                    {tx.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => handleSubmitTx(tx.txId)}
                        disabled={loading}
                        style={{ marginTop: 8, padding: '6px 12px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: '0.875rem' }}
                      >
                        Submit Transaction
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </AnimatePresence>
    </section>
  );
}
