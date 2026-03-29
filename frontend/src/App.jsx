import { useEffect, useCallback } from 'react';
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
import { Spinner } from './components/Spinner';
import { TransactionHistory } from './components/TransactionHistory';
import { FeeDisplay } from './components/FeeDisplay';
import { logError } from './utils/errorLogger';
import { ImportAccountForm } from './components/ImportAccountForm';
import { useTheme } from './contexts/ThemeContext';
import { useAppState, useAppDispatch, A } from './store/index.js';

const STATUS_COLORS = { connected: '#22c55e', disconnected: '#ef4444', reconnecting: '#f59e0b' };
const TIMEOUT_MS = 30000;

function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out. Please try again.')), TIMEOUT_MS)
    ),
  ]);
}

function App() {
  const [account, setAccount] = useState(null);
  const [balance, setBalance] = useState(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState('');
  const [showQR, setShowQR] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const { account, balance, loading, recipient, amount, showQR, showImportForm, showShortcuts } = useAppState();
  const dispatch = useAppDispatch();

  const msg = useMessages();
  const { canInstall, install, updateAvailable, applyUpdate } = usePWA();
  const { queue: queueOffline, pendingCount } = useOfflineQueue();
  const { theme, isDark, toggleTheme } = useTheme();
  const prefersReduced = useReducedMotion();
  const v = makeVariants(prefersReduced);
  const tap = tapScale(prefersReduced);

  const setLoading = (val) => dispatch({ type: A.SET_LOADING, payload: val });

  const handleWsMessage = useCallback((wsMsg) => {
    if (wsMsg.type === 'transaction') {
      const text = wsMsg.direction === 'received'
        ? `📥 Received ${wsMsg.amount} ${wsMsg.assetCode} — tx: ${wsMsg.hash?.slice(0, 8)}…`
        : `📤 Sent ${wsMsg.amount} ${wsMsg.assetCode} — tx: ${wsMsg.hash?.slice(0, 8)}…`;
      msg.info(text);
      if (wsMsg.balance) dispatch({ type: A.SET_BALANCE, payload: { balances: wsMsg.balance } });
    }
  }, [msg]);
  }, [msg, dispatch]);

  const wsStatus = useWebSocket(account?.publicKey ?? null, handleWsMessage);
  const { status: networkStatus } = useNetworkStatus();

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        if (loading !== 'create') createAccount();
      }
      if (e.key === 'Escape') {
        dispatch({ type: A.SET_SHOW_QR, payload: false });
        dispatch({ type: A.SET_SHOW_SHORTCUTS, payload: false });
      }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        const tag = document.activeElement?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA')
          dispatch({ type: A.SET_SHOW_SHORTCUTS, payload: !showShortcuts });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);
  }, [loading, showShortcuts]);

  const resetForm = () => dispatch({ type: A.RESET_FORM });

  const resetForm = () => { setRecipient(''); setAmount(''); };
  const clearForm = () => {
    if ((recipient || amount) && !window.confirm('Clear the payment form?')) return;
    resetForm();
  };

  const createAccount = async () => {
    setLoading('create');
    try {
      const { data } = await withTimeout(axios.post('/api/stellar/account/create'));
      dispatch({ type: A.SET_ACCOUNT, payload: data });
      resetForm();
      msg.success('Account created! Save your secret key securely.');
    } catch (error) {
      logError(error, { context: 'createAccount' });
      msg.error(getFriendlyError(error), { retry: createAccount });
    } finally { setLoading(''); }
  };

  const importAccount = async (secretKey) => {
    setLoading('import');
    try {
      const { data } = await axios.post('/api/stellar/account/import', { secretKey });
      dispatch({ type: A.SET_ACCOUNT, payload: data });
      dispatch({ type: A.SET_SHOW_IMPORT, payload: false });
      msg.success('Account imported successfully!');
    } catch (error) {
      logError(error, { context: 'importAccount' });
      msg.error(getFriendlyError(error));
    } finally { setLoading(''); }
  };

  const checkBalance = async () => {
    if (!account) return;
    setLoading('balance');
    try {
      const { data } = await withTimeout(axios.get(`/api/stellar/account/${account.publicKey}`));
      dispatch({ type: A.SET_BALANCE, payload: data });
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

    // Optimistic balance update
    const numAmount = parseFloat(amount);
    if (xlmBalance !== null) {
      const optimisticBalances = balance.balances.map(b =>
        b.asset === 'XLM' ? { ...b, balance: String((parseFloat(b.balance) - numAmount).toFixed(7)) } : b
      );
      dispatch({ type: A.SET_BALANCE_OPTIMISTIC, payload: { balances: optimisticBalances } });
    }

    try {
      const { data } = await withTimeout(axios.post('/api/stellar/payment/send', payload));
      msg.success(`Payment sent! Hash: ${data.hash}`);
      resetForm();
      checkBalance(); // sync real balance
    } catch (error) {
      dispatch({ type: A.REVERT_BALANCE }); // roll back optimistic update
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
    <>
      {/* Skip navigation link */}
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <div className="app">
        {/* Screen-reader live region for loading states */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {loading === 'create' && 'Creating account…'}
          {loading === 'balance' && 'Checking balance…'}
          {loading === 'send' && 'Sending payment…'}
          {loading === 'import' && 'Importing account…'}
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
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={toggleTheme}
            aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
          >
            {isDark ? '☀️ Light' : '🌙 Dark'}
          </button>
          {canInstall && (
            <button type="button" className="pwa-install-btn" onClick={install} title="Install app">
              ⬇ Install
            </button>
          )}
          <button
            type="button"
            className="shortcuts-help-btn"
            onClick={() => dispatch({ type: A.SET_SHOW_SHORTCUTS, payload: !showShortcuts })}
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

        {/* PWA banners */}
        <AnimatePresence>
          {updateAvailable && (
            <motion.div className="pwa-banner pwa-banner--update" role="status" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
              <span>A new version is available.</span>
              <button type="button" className="pwa-banner__btn" onClick={applyUpdate}>Update now</button>
            </motion.div>
          )}
        </AnimatePresence>
      {/* Keyboard shortcuts panel */}
      <AnimatePresence>
        {showShortcuts && (
          <motion.div className="shortcuts-panel" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" variants={v.pop} initial="hidden" animate="visible" exit="exit">
            <div className="shortcuts-panel__header">
              <strong>Keyboard Shortcuts</strong>
              <button type="button" className="qr-close" onClick={() => dispatch({ type: A.SET_SHOW_SHORTCUTS, payload: false })} aria-label="Close">✕</button>
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

      {/* Create / Import Account */}
      <motion.div className="section" variants={v.fadeSlide} initial="hidden" animate="visible">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <motion.button onClick={createAccount} {...tap} disabled={loading === 'create'} title="Create account (Ctrl+N)">
            {loading === 'create' ? <Spinner label="Creating account..." /> : 'Create Account'}
          </motion.button>
          <motion.button
            onClick={() => dispatch({ type: A.SET_SHOW_IMPORT, payload: !showImportForm })}
            {...tap}
            style={{ background: '#6366f1' }}
          >
            {showImportForm ? 'Cancel Import' : 'Import Account'}
          </motion.button>
        </div>
        <AnimatePresence>
          {pendingCount > 0 && (
            <motion.div className="pwa-banner pwa-banner--queue" role="status" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
              {pendingCount} payment{pendingCount > 1 ? 's' : ''} queued offline — will sync when back online.
            </motion.div>
          )}
        </AnimatePresence>

        <header>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h1>Stellar Remittance Platform</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                className="theme-toggle-btn"
                onClick={toggleTheme}
                aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
                title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
              >
                {isDark ? '☀️ Light' : '🌙 Dark'}
              </button>
              {canInstall && (
                <button type="button" className="pwa-install-btn" onClick={install} aria-label="Install app">
                  ⬇ Install
                </button>
              )}
              <button
                type="button"
                className="shortcuts-help-btn"
                onClick={() => setShowShortcuts((s) => !s)}
                aria-label="Show keyboard shortcuts"
                aria-expanded={showShortcuts}
                aria-controls="shortcuts-panel"
              >
                ⌨
              </button>
              <NetworkBadge status={networkStatus} />
              <motion.span
                animate={{ opacity: [0.6, 1, 0.6] }}
                transition={{ repeat: Infinity, duration: 2 }}
                style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6 }}
                aria-label={`WebSocket status: ${wsStatus}`}
                role="status"
              >
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLORS[wsStatus], display: 'inline-block' }} aria-hidden="true" />
                <span aria-hidden="true">{wsStatus}</span>
              </motion.span>
            </div>
          </div>
        </header>

        {/* Keyboard shortcuts panel */}
        <AnimatePresence>
          {showShortcuts && (
            <motion.div
              id="shortcuts-panel"
              className="shortcuts-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="shortcuts-title"
              variants={v.pop} initial="hidden" animate="visible" exit="exit"
            >
              <div className="shortcuts-panel__header">
                <strong id="shortcuts-title">Keyboard Shortcuts</strong>
                <button type="button" className="qr-close" onClick={() => setShowShortcuts(false)} aria-label="Close keyboard shortcuts">✕</button>
              </div>
              <ul className="shortcuts-list">
                <li><kbd>Ctrl+N</kbd> Create new account</li>
                <li><kbd>Ctrl+C</kbd> Copy key (when copy button focused)</li>
                <li><kbd>Escape</kbd> Close modals</li>
                <li><kbd>?</kbd> Toggle this help</li>
                <li><kbd>Tab</kbd> Navigate between fields</li>
                <li><kbd>Enter</kbd> Submit focused form</li>
              </ul>
        <AnimatePresence>
          {account && (
            <motion.div className="account-info" variants={v.pop} initial="hidden" animate="visible" exit="exit">
              <div className="key-row">
                <span className="key-label">Public Key:</span>
                <span className="key-value">{account.publicKey}</span>
                <CopyButton text={account.publicKey} label="Copy public key" />
              </div>
              {account.secretKey && (
                <div className="key-row">
                  <span className="key-label">Secret Key:</span>
                  <span className="key-value">{account.secretKey}</span>
                  <CopyButton text={account.secretKey} label="Copy secret key" />
                </div>
              )}
              <motion.button className="qr-trigger" onClick={() => dispatch({ type: A.SET_SHOW_QR, payload: true })} {...tap}>
                🔲 Show QR Code
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        <main id="main-content">
          {/* Create / Import Account */}
          <motion.section className="section" aria-labelledby="account-heading" variants={v.fadeSlide} initial="hidden" animate="visible">
            <h2 id="account-heading" className="sr-only">Account</h2>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <motion.button
                onClick={createAccount}
                {...tap}
                disabled={loading === 'create'}
                aria-label="Create new Stellar account (Ctrl+N)"
                aria-busy={loading === 'create'}
              >
                {loading === 'create' ? <Spinner label="Creating account…" /> : 'Create Account'}
              </motion.button>
              <motion.button
                onClick={() => setShowImportForm((s) => !s)}
                {...tap}
                style={{ background: '#6366f1' }}
                aria-expanded={showImportForm}
                aria-controls="import-form"
              >
                {showImportForm ? 'Cancel Import' : 'Import Account'}
              </motion.button>
            </div>

            <AnimatePresence>
              {showImportForm && (
                <motion.div id="import-form" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
                  <ImportAccountForm onImport={importAccount} loading={loading} />
                </motion.div>
              )}
            </AnimatePresence>
            {/* Send Payment */}
            <motion.div className="section" variants={v.fadeSlide}>
              <ErrorBoundary context="send-payment">
                <h3>Send Payment</h3>
                <div className="input-wrap">
                  <input
                    type="text"
                    placeholder="Recipient Public Key"
                    value={recipient}
                    onChange={(e) => dispatch({ type: A.SET_RECIPIENT, payload: e.target.value })}
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
                    onChange={(e) => dispatch({ type: A.SET_AMOUNT, payload: formatAmount(e.target.value) })}
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
                <FeeDisplay amount={amount} visible={amountValid} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <motion.button onClick={sendPayment} {...tap} disabled={!recipientValid || !amountValid || loading === 'send'}>
                    {loading === 'send' ? <Spinner label="Sending payment..." /> : 'Send'}
                  </motion.button>
                  <motion.button
                    className="btn-clear"
                    onClick={clearForm}
                    {...tap}
                    disabled={loading === 'send' || (!recipient && !amount)}
                  >
                    Clear
                  </motion.button>
                </div>
              </ErrorBoundary>
            </motion.div>

            <AnimatePresence>
              {account && (
                <motion.div className="account-info" variants={v.pop} initial="hidden" animate="visible" exit="exit" aria-label="Account details">
                  <div className="key-row">
                    <span className="key-label" id="pubkey-label">Public Key:</span>
                    <span className="key-value" aria-labelledby="pubkey-label">{account.publicKey}</span>
                    <CopyButton text={account.publicKey} label="Copy public key" />
                  </div>
                  <div className="key-row">
                    <span className="key-label" id="seckey-label">Secret Key:</span>
                    <span className="key-value" aria-labelledby="seckey-label">{account.secretKey}</span>
                    <CopyButton text={account.secretKey} label="Copy secret key" />
                  </div>
                  <motion.button
                    className="qr-trigger"
                    onClick={() => setShowQR(true)}
                    {...tap}
                    aria-label="Show QR code for this account"
                  >
                    🔲 Show QR Code
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>

          <AnimatePresence>
            {account && (
              <motion.div variants={v.stagger} initial="hidden" animate="visible" exit="exit">

                {/* Balance */}
                <motion.section className="section" aria-labelledby="balance-heading" variants={v.fadeSlide}>
                  <h2 id="balance-heading" className="sr-only">Balance</h2>
                  <motion.button
                    onClick={checkBalance}
                    {...tap}
                    disabled={loading === 'balance'}
                    aria-busy={loading === 'balance'}
                    aria-label="Check account balance"
                  >
                    {loading === 'balance' ? <Spinner label="Checking balance…" /> : 'Check Balance'}
                  </motion.button>
                  <AnimatePresence>
                    {balance && (
                      <motion.div
                        variants={v.pop} initial="hidden" animate="visible" exit="exit"
                        style={{ marginTop: 10 }}
                        aria-label="Account balances"
                        role="list"
                      >
                        {balance.balances.map((b, i) => (
                          <motion.p key={i} variants={v.fadeSlide} className="balance-row" role="listitem">
                            <span className="balance-asset">{b.asset}</span>
                            <span className="balance-amount">{formatBalanceWithAsset(b.balance, b.asset)}</span>
                          </motion.p>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.section>

                {/* Send Payment */}
                <motion.section className="section" aria-labelledby="send-heading" variants={v.fadeSlide}>
                  <ErrorBoundary context="send-payment">
                    <h2 id="send-heading">Send Payment</h2>
                    <div className="input-wrap">
                      <label htmlFor="recipient-input" className="sr-only">Recipient public key</label>
                      <input
                        id="recipient-input"
                        type="text"
                        placeholder="Recipient Public Key"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && sendPayment()}
                        style={{ border: `2px solid ${recipientTouched ? (recipientValid ? '#22c55e' : '#ef4444') : '#ccc'}` }}
                        aria-label="Recipient public key"
                        aria-invalid={recipientTouched && !recipientValid}
                        aria-describedby={recipientTouched && !recipientValid ? 'recipient-error' : undefined}
                        autoComplete="off"
                      />
                      {recipientTouched && <span className="input-icon" aria-hidden="true">{recipientValid ? '✅' : '❌'}</span>}
                    </div>
                    <AnimatePresence>
                      {recipientTouched && !recipientValid && (
                        <motion.p id="recipient-error" className="field-error" role="alert" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
                          Invalid Stellar address format (must start with G and be 56 characters)
                        </motion.p>
                      )}
                    </AnimatePresence>

                    <div className="input-wrap">
                      <label htmlFor="amount-input" className="sr-only">Payment amount in XLM</label>
                      <input
                        id="amount-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="Amount (XLM)"
                        value={amount}
                        onChange={(e) => setAmount(formatAmount(e.target.value))}
                        onKeyDown={(e) => e.key === 'Enter' && sendPayment()}
                        style={{ border: `2px solid ${amountTouched ? (amountValid ? '#22c55e' : '#ef4444') : '#ccc'}` }}
                        aria-label="Payment amount in XLM"
                        aria-invalid={amountTouched && !!amountError}
                        aria-describedby={amountTouched && amountError ? 'amount-error' : undefined}
                      />
                      {amountTouched && <span className="input-icon" aria-hidden="true">{amountValid ? '✅' : '❌'}</span>}
                    </div>
                    <AnimatePresence>
                      {amountTouched && amountError && (
                        <motion.p id="amount-error" className="field-error" role="alert" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
                          {amountError}
                        </motion.p>
                      )}
                    </AnimatePresence>

                    <FeeDisplay amount={amount} visible={amountValid} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <motion.button
                        onClick={sendPayment}
                        {...tap}
                        disabled={!recipientValid || !amountValid || loading === 'send'}
                        aria-busy={loading === 'send'}
                        aria-label="Send XLM payment"
                      >
                        {loading === 'send' ? <Spinner label="Sending payment…" /> : 'Send'}
                      </motion.button>
                      <motion.button
                        className="btn-clear"
                        onClick={clearForm}
                        {...tap}
                        disabled={loading === 'send' || (!recipient && !amount)}
                        aria-label="Clear payment form"
                      >
                        Clear
                      </motion.button>
                    </div>
                  </ErrorBoundary>
                </motion.section>

                {/* Transaction History */}
                <motion.div variants={v.fadeSlide}>
                  <TransactionHistory publicKey={account.publicKey} />
                </motion.div>

              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <StatusMessage
          messages={msg.messages}
          history={msg.history}
          onRemove={msg.remove}
          showHistory={true}
        />

        <AnimatePresence>
          {showQR && account && (
            <QRCodeModal publicKey={account.publicKey} onClose={() => setShowQR(false)} />
          )}
        </AnimatePresence>
      </div>
    </>
      {/* QR Code Modal */}
      <AnimatePresence>
        {showQR && account && (
          <QRCodeModal publicKey={account.publicKey} onClose={() => dispatch({ type: A.SET_SHOW_QR, payload: false })} />
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
