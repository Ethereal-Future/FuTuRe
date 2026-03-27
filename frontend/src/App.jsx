import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { isValidStellarAddress } from './utils/validateStellarAddress';
import { validateAmount, formatAmount } from './utils/validateAmount';
import { getFriendlyError } from './utils/errorMessages';
import { formatBalanceWithAsset } from './utils/formatBalance';
import { useWebSocket } from './hooks/useWebSocket';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { useMessages } from './hooks/useMessages';
import { usePWA } from './hooks/usePWA';
import { useOfflineQueue } from './hooks/useOfflineQueue';
import { makeVariants, tapScale } from './utils/animations';
import { ErrorBoundary } from './components/ErrorBoundary';
import { QRCodeModal } from './components/QRCodeModal';
import { NetworkBadge } from './components/NetworkBadge';
import { StatusMessage } from './components/StatusMessage';
import { CopyButton } from './components/CopyButton';
import { logError } from './utils/errorLogger';

const STATUS_COLORS = { connected: '#22c55e', disconnected: '#ef4444', reconnecting: '#f59e0b' };

function Spinner() {
  return (
    <motion.span
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, duration: 0.7, ease: 'linear' }}
      style={{ display: 'inline-block', marginLeft: 8 }}
    >⟳</motion.span>
  );
}

function App() {
  const [account, setAccount] = useState(null);
  const [balance, setBalance] = useState(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState('');
  const [showQR, setShowQR] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const msg = useMessages();
  const { canInstall, install, updateAvailable, applyUpdate } = usePWA();
  const { queue: queueOffline, pendingCount } = useOfflineQueue();

  const prefersReduced = useReducedMotion();
  const v = makeVariants(prefersReduced);
  const tap = tapScale(prefersReduced);

  const handleWsMessage = (wsMsg) => {
    if (wsMsg.type === 'transaction') {
      const text = wsMsg.direction === 'received'
        ? `📥 Received ${wsMsg.amount} ${wsMsg.assetCode} — tx: ${wsMsg.hash?.slice(0, 8)}…`
        : `📤 Sent ${wsMsg.amount} ${wsMsg.assetCode} — tx: ${wsMsg.hash?.slice(0, 8)}…`;
      msg.info(text);
      if (wsMsg.balance) setBalance((prev) => prev ? { ...prev, balances: wsMsg.balance } : null);
    }
  };

  const wsStatus = useWebSocket(account?.publicKey ?? null, handleWsMessage);
  const { status: networkStatus } = useNetworkStatus();

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e) => {
      // Ctrl+N: create new account
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        if (loading !== 'create') createAccount();
      }
      // Escape: close modals
      if (e.key === 'Escape') {
        setShowQR(false);
        setShowShortcuts(false);
      }
      // ?: show shortcuts help
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        const tag = document.activeElement?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') setShowShortcuts((s) => !s);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const createAccount = async () => {
    setLoading('create');
    try {
      const { data } = await axios.post('/api/stellar/account/create');
      setAccount(data);
      msg.success('Account created! Save your secret key securely.');
    } catch (error) {
      logError(error, { context: 'createAccount' });
      msg.error(getFriendlyError(error), { retry: createAccount });
    } finally { setLoading(''); }
  };

  const checkBalance = async () => {
    if (!account) return;
    setLoading('balance');
    try {
      const { data } = await axios.get(`/api/stellar/account/${account.publicKey}`);
      setBalance(data);
    } catch (error) {
      logError(error, { context: 'checkBalance' });
      msg.error(getFriendlyError(error), { retry: checkBalance });
    } finally { setLoading(''); }
  };

  const recipientValid = isValidStellarAddress(recipient);
  const recipientTouched = recipient.length > 0;
  const xlmBalance = balance?.balances?.find(b => b.asset === 'XLM')?.balance ?? null;
  const amountTouched = amount.length > 0;
  const amountError = validateAmount(amount, xlmBalance !== null ? parseFloat(xlmBalance) : null);
  const amountValid = amountTouched && !amountError;

  const sendPayment = async () => {
    if (!account || !recipientValid || !amountValid) return;
    setLoading('send');
    const payload = { sourceSecret: account.secretKey, destination: recipient, amount, assetCode: 'XLM' };
    try {
      const { data } = await axios.post('/api/stellar/payment/send', payload);
      msg.success(`Payment sent! Hash: ${data.hash}`);
      checkBalance();
    } catch (error) {
      // If offline, queue for background sync
      if (!navigator.onLine) {
        await queueOffline(payload);
        msg.info('You are offline. Payment queued and will sync automatically.');
      } else {
        logError(error, { context: 'sendPayment' });
        msg.error(getFriendlyError(error), { retry: sendPayment });
      }
    } finally { setLoading(''); }
  };

  return (
    <div className="app">
      {/* PWA: update available banner */}
      <AnimatePresence>
        {updateAvailable && (
          <motion.div className="pwa-banner pwa-banner--update" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
            <span>A new version is available.</span>
            <button type="button" className="pwa-banner__btn" onClick={applyUpdate}>Update now</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PWA: offline queue indicator */}
      <AnimatePresence>
        {pendingCount > 0 && (
          <motion.div className="pwa-banner pwa-banner--queue" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
            {pendingCount} payment{pendingCount > 1 ? 's' : ''} queued offline — will sync when back online.
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Stellar Remittance Platform</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {canInstall && (
            <button type="button" className="pwa-install-btn" onClick={install} title="Install app">
              ⬇ Install
            </button>
          )}
          <button
            type="button"
            className="shortcuts-help-btn"
            onClick={() => setShowShortcuts((s) => !s)}
            title="Keyboard shortcuts (?)"
            aria-label="Show keyboard shortcuts"
          >
            ⌨
          </button>
          <NetworkBadge status={networkStatus} />
          <motion.span
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{ repeat: Infinity, duration: 2 }}
            style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLORS[wsStatus], display: 'inline-block' }} />
            {wsStatus}
          </motion.span>
        </div>
      </div>

      {/* Keyboard shortcuts panel */}
      <AnimatePresence>
        {showShortcuts && (
          <motion.div className="shortcuts-panel" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" variants={v.pop} initial="hidden" animate="visible" exit="exit">
            <div className="shortcuts-panel__header">
              <strong>Keyboard Shortcuts</strong>
              <button type="button" className="qr-close" onClick={() => setShowShortcuts(false)} aria-label="Close">✕</button>
            </div>
            <ul className="shortcuts-list">
              <li><kbd>Ctrl+N</kbd> Create new account</li>
              <li><kbd>Ctrl+C</kbd> Copy key (when copy button focused)</li>
              <li><kbd>Escape</kbd> Close modals</li>
              <li><kbd>?</kbd> Toggle this help</li>
              <li><kbd>Tab</kbd> Navigate between fields</li>
              <li><kbd>Enter</kbd> Submit focused form</li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Account */}
      <motion.div className="section" variants={v.fadeSlide} initial="hidden" animate="visible">
        <motion.button onClick={createAccount} {...tap} disabled={loading === 'create'} title="Create account (Ctrl+N)">
          Create Account {loading === 'create' && <Spinner />}
        </motion.button>
        <AnimatePresence>
          {account && (
            <motion.div
              className="account-info"
              variants={v.pop}
              initial="hidden" animate="visible" exit="exit"
            >
              <div className="key-row">
                <span className="key-label">Public Key:</span>
                <span className="key-value">{account.publicKey}</span>
                <CopyButton text={account.publicKey} label="Copy public key" />
              </div>
              <div className="key-row">
                <span className="key-label">Secret Key:</span>
                <span className="key-value">{account.secretKey}</span>
                <CopyButton text={account.secretKey} label="Copy secret key" />
              </div>
              <motion.button className="qr-trigger" onClick={() => setShowQR(true)} {...tap}>
                🔲 Show QR Code
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {account && (
          <motion.div variants={v.stagger} initial="hidden" animate="visible" exit="exit">

            {/* Balance */}
            <motion.div className="section" variants={v.fadeSlide}>
              <motion.button onClick={checkBalance} {...tap} disabled={loading === 'balance'}>
                Check Balance {loading === 'balance' && <Spinner />}
              </motion.button>
              <AnimatePresence>
                {balance && (
                  <motion.div variants={v.pop} initial="hidden" animate="visible" exit="exit" style={{ marginTop: 10 }}>
                    {balance.balances.map((b, i) => (
                      <motion.p key={i} variants={v.fadeSlide} className="balance-row">
                        <span className="balance-asset">{b.asset}</span>
                        <span className="balance-amount">{formatBalanceWithAsset(b.balance, b.asset)}</span>
                      </motion.p>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Send Payment */}
            <motion.div className="section" variants={v.fadeSlide}>
              <ErrorBoundary context="send-payment">
              <h3>Send Payment</h3>
              <div className="input-wrap">
                <input
                  type="text"
                  placeholder="Recipient Public Key"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendPayment()}
                  style={{ border: `2px solid ${recipientTouched ? (recipientValid ? '#22c55e' : '#ef4444') : '#ccc'}` }}
                  aria-label="Recipient public key"
                />
                {recipientTouched && <span className="input-icon">{recipientValid ? '✅' : '❌'}</span>}
              </div>
              <AnimatePresence>
                {recipientTouched && !recipientValid && (
                  <motion.p className="field-error" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
                    Invalid Stellar address format (must start with G and be 56 characters)
                  </motion.p>
                )}
              </AnimatePresence>
              <div className="input-wrap">
                <input
                  type="text"
                  placeholder="Amount (XLM)"
                  value={amount}
                  onChange={(e) => setAmount(formatAmount(e.target.value))}
                  onKeyDown={(e) => e.key === 'Enter' && sendPayment()}
                  style={{ border: `2px solid ${amountTouched ? (amountValid ? '#22c55e' : '#ef4444') : '#ccc'}` }}
                  aria-label="Payment amount in XLM"
                />
                {amountTouched && <span className="input-icon">{amountValid ? '✅' : '❌'}</span>}
              </div>
              <AnimatePresence>
                {amountTouched && amountError && (
                  <motion.p className="field-error" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
                    {amountError}
                  </motion.p>
                )}
              </AnimatePresence>
              <motion.button onClick={sendPayment} {...tap} disabled={!recipientValid || !amountValid || loading === 'send'}>
                Send {loading === 'send' && <Spinner />}
              </motion.button>
              </ErrorBoundary>
            </motion.div>

          </motion.div>
        )}
      </AnimatePresence>

      {/* Status Messages */}
      <StatusMessage
        messages={msg.messages}
        history={msg.history}
        onRemove={msg.remove}
        showHistory={true}
      />

      {/* QR Code Modal */}
      <AnimatePresence>
        {showQR && account && (
          <QRCodeModal publicKey={account.publicKey} onClose={() => setShowQR(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
