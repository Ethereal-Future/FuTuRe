import { useState, useEffect } from 'react';
import {
  discoverAnchor,
  initiateDeposit,
  initiateWithdrawal,
  pollTransactionStatus,
  isTerminalState,
} from '../services/sep24.js';
import apiClient from '../api/client.js';

export function SEP24Flow({ assetCode, assetIssuer, publicKey, type = 'deposit', onClose, onSuccess }) {
  const [step, setStep] = useState('loading'); // loading, auth, interactive, polling, complete, error
  const [error, setError] = useState('');
  const [anchorDomain, setAnchorDomain] = useState('');
  const [anchorInfo, setAnchorInfo] = useState(null);
  const [interactiveUrl, setInteractiveUrl] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [transactionStatus, setTransactionStatus] = useState(null);
  const [token, setToken] = useState('');
  const [iframeKey, setIframeKey] = useState(0);

  useEffect(() => {
    initializeFlow();
  }, []);

  const initializeFlow = async () => {
    try {
      setStep('loading');
      setError('');

      // Try to auto-discover anchor from issuer account
      // In real implementation, user would select anchor from list
      if (!assetIssuer) {
        setError('Asset issuer required for SEP-24 flow');
        setStep('error');
        return;
      }

      // For demo, use a known anchor or require user input
      // In production, fetch from directory or let user choose
      setAnchorDomain('example-anchor.com'); // Placeholder
      setStep('auth');
    } catch (e) {
      setError(e.message);
      setStep('error');
    }
  };

  const handleAnchorDomainSubmit = async (domain) => {
    try {
      setError('');
      setStep('loading');

      const anchor = await discoverAnchor(domain);

      if (!anchor.sep24Enabled) {
        setError('This anchor does not support SEP-24');
        setStep('error');
        return;
      }

      setAnchorDomain(domain);

      // Request SEP-10 token from backend
      const response = await apiClient.post('/api/sep24/authenticate', {
        domain,
        publicKey,
        secretKey: localStorage.getItem('secretKey'),
      });

      setToken(response.data.token);

      // Initiate deposit/withdrawal
      const flowResponse = await apiClient.post('/api/sep24/initiate', {
        domain,
        type,
        assetCode,
        token: response.data.token,
      });

      setTransactionId(flowResponse.data.id);
      setInteractiveUrl(flowResponse.data.url);
      setStep('interactive');
    } catch (e) {
      setError(e.message);
      setStep('error');
    }
  };

  const handleInteractiveComplete = async () => {
    try {
      setStep('polling');
      setError('');

      // Poll for transaction completion
      const status = await apiClient.post('/api/sep24/poll-status', {
        domain: anchorDomain,
        transactionId,
        token,
        type,
      });

      setTransactionStatus(status.data);

      if (isTerminalState(status.data.status)) {
        if (status.data.status === 'completed') {
          setStep('complete');
          onSuccess?.();
        } else {
          setError(`Transaction ${status.data.status}`);
          setStep('error');
        }
      }
    } catch (e) {
      setError(e.message);
      setStep('error');
    }
  };

  const handleMessageFromIframe = (event) => {
    // Verify origin is trusted
    if (event.origin.includes(anchorDomain)) {
      if (event.data.type === 'interactive-complete') {
        handleInteractiveComplete();
      } else if (event.data.type === 'error') {
        setError(event.data.message);
        setStep('error');
      }
    }
  };

  useEffect(() => {
    window.addEventListener('message', handleMessageFromIframe);
    return () => window.removeEventListener('message', handleMessageFromIframe);
  }, [anchorDomain, transactionId, token]);

  return (
    <div
      className="replay-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sep24-title"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="replay-modal" style={{ maxWidth: 600, width: '100%', minHeight: 400 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <h2 id="sep24-title" style={{ margin: 0 }}>
            {type === 'deposit' ? 'Deposit' : 'Withdraw'} {assetCode}
          </h2>
          <button type="button" className="qr-close" onClick={onClose} aria-label="Close flow">
            ✕
          </button>
        </div>

        {error && (
          <p role="alert" style={{ color: '#ef4444', marginBottom: 12 }}>
            {error}
          </p>
        )}

        {step === 'loading' && (
          <p style={{ textAlign: 'center', color: '#64748b' }}>Loading SEP-24 flow…</p>
        )}

        {step === 'auth' && (
          <div>
            <p style={{ marginBottom: 12, color: '#64748b' }}>Enter anchor domain to continue:</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAnchorDomainSubmit(anchorDomain);
              }}
            >
              <input
                type="text"
                value={anchorDomain}
                onChange={(e) => setAnchorDomain(e.target.value)}
                placeholder="anchor.example.com"
                style={{ marginBottom: 8, width: '100%' }}
              />
              <button type="submit" style={{ width: '100%' }}>
                Continue
              </button>
            </form>
          </div>
        )}

        {step === 'interactive' && (
          <div>
            <p style={{ marginBottom: 12, color: '#64748b', fontSize: '0.9rem' }}>
              Complete the {type} process in the window below.
            </p>
            <iframe
              key={iframeKey}
              src={interactiveUrl}
              title="Anchor Interactive Window"
              style={{
                width: '100%',
                height: 500,
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                marginBottom: 12,
              }}
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation"
            />
            <button
              type="button"
              onClick={handleInteractiveComplete}
              style={{ width: '100%', marginBottom: 8 }}
            >
              Check Status
            </button>
            <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
              The window will close automatically when complete. Click "Check Status" if it doesn't.
            </p>
          </div>
        )}

        {step === 'polling' && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <p style={{ color: '#64748b', marginBottom: 20 }}>Processing your transaction…</p>
            <div style={{ fontSize: '2rem', animation: 'spin 1s linear infinite' }}>⏳</div>
          </div>
        )}

        {step === 'complete' && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <p style={{ fontSize: '2rem', marginBottom: 12 }}>✓</p>
            <p style={{ color: '#22c55e', fontWeight: 600, marginBottom: 12 }}>
              {type === 'deposit' ? 'Deposit' : 'Withdrawal'} completed successfully!
            </p>
            <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: 20 }}>
              Transaction ID: {transactionId}
            </p>
            <button
              type="button"
              onClick={onClose}
              style={{ width: '100%', background: '#22c55e' }}
            >
              Done
            </button>
          </div>
        )}

        {step === 'error' && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <p style={{ fontSize: '2rem', marginBottom: 12 }}>✗</p>
            <p style={{ color: '#ef4444', fontWeight: 600, marginBottom: 12 }}>
              {type === 'deposit' ? 'Deposit' : 'Withdrawal'} failed
            </p>
            <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: 20 }}>
              {error}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setStep('auth');
                }}
                style={{ flex: 1 }}
              >
                Try Again
              </button>
              <button type="button" onClick={onClose} className="btn-clear" style={{ flex: 1 }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
