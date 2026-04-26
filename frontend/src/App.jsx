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
import { useRTL } from './hooks/useRTL';
import { makeVariants, tapScale } from './utils/animations';
import { ErrorBoundary } from './components/ErrorBoundary';
import { QRCodeModal } from './components/QRCodeModal';
import { QRScanner } from './components/QRScanner';
import { NetworkBadge } from './components/NetworkBadge';
import { NetworkStatusBanner } from './components/NetworkStatusBanner';
import { StatusMessage } from './components/StatusMessage';
import { CopyButton } from './components/CopyButton';
import { Spinner } from './components/Spinner';
import { TransactionHistory } from './components/TransactionHistory';
import { StreamPayment } from './components/StreamPayment';
import { PathPayment } from './components/PathPayment';
import { AccountSettings } from './components/AccountSettings';
import { FeeDisplay } from './components/FeeDisplay';
import { InlineConfirmation } from './components/InlineConfirmation';
import { logError } from './utils/errorLogger';
import { ImportAccountForm } from './components/ImportAccountForm';
import { ConfirmSendDialog } from './components/ConfirmSendDialog';
import { LanguageSelector } from './components/LanguageSelector';
import { FileUpload } from './components/FileUpload';
import { AccountCreatedCelebration } from './components/AccountCreatedCelebration';
import { TxLookup } from './components/TxLookup';
import { AddressBook } from './components/AddressBook';
import { MultiSigTransactions } from './components/MultiSigTransactions';
import { KYCForm } from './components/KYCForm';
import { NotificationPreferences } from './components/NotificationPreferences';
import { NotificationBell } from './components/NotificationBell';
import { useTheme } from './contexts/ThemeContext';
import { useAppState, useAppDispatch, A } from './store/index.js';
import { useExchangeRate } from './hooks/useExchangeRate';
import { AMMPoolBrowser } from './components/AMMPoolBrowser';
import { ConvertWidget } from './components/ConvertWidget';
import { AccountRecovery } from './components/AccountRecovery';
import { XLMInfoIcon } from './components/XLMInfoIcon';
import { ComplianceDashboard } from './components/ComplianceDashboard';
import { BackupSettings } from './components/BackupSettings';

const TIMEOUT_MS = 30000;
const KYC_LARGE_TRANSACTION_LIMIT = 1000;

function withTimeout(promiseFn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return promiseFn(controller.signal).finally(() => clearTimeout(timer));
}

function App() {
  const { account, balance, loading, recipient, amount, memo, memoType, showQR, showImportForm, showShortcuts, accountLabel } = useAppState();
  const dispatch = useAppDispatch();

  // Local state not in store
  const [showConfirm, setShowConfirm] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [replaySecret, setReplaySecret] = useState('');
  const [showReplayPrompt, setShowReplayPrompt] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState('');
  const [showCelebration, setShowCelebration] = useState(false);
  const [kycStatus, setKycStatus] = useState(null);
  const [kycLoading, setKycLoading] = useState(false);
  const [kycError, setKycError] = useState(null);
  const [showComplianceDashboard, setShowComplianceDashboard] = useState(false);
  const [showBackupSettings, setShowBackupSettings] = useState(false);
  const [userRole, setUserRole] = useState(null);

  const msg = useMessages();
  const { canInstall, install, updateAvailable, applyUpdate, pushEnabled, enablePush } = usePWA();
  const { queue: queueOffline, dequeue, pendingItems, pendingCount } = useOfflineQueue();
  const [showTxLookup, setShowTxLookup] = useState(false);
  const [deepLinkHash, setDeepLinkHash] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [lastWsMessage, setLastWsMessage] = useState(null);
  const [activeSettingsSection, setActiveSettingsSection] = useState(null); // null, 'multisig', 'kyc', 'notifications'
  const { isDark, toggleTheme } = useTheme();
  useRTL();
  const prefersReduced = useReducedMotion();
  const v = makeVariants(prefersReduced);
  const tap = tapScale(prefersReduced);

  const handleWsMessage = useCallback((wsMsg) => {
    setLastWsMessage(wsMsg);
    if (wsMsg.type === 'transaction') {
      const text = wsMsg.direction === 'received'
        ? `📥 Received ${wsMsg.amount} ${wsMsg.assetCode} — tx: ${wsMsg.hash?.slice(0, 8)}…`
        : `📤 Sent ${wsMsg.amount} ${wsMsg.assetCode} — tx: ${wsMsg.hash?.slice(0, 8)}…`;
      msg.info(text);
      if (wsMsg.balance) dispatch({ type: A.SET_BALANCE, payload: { balances: wsMsg.balance } });
    }
  }, [msg, dispatch]);

  const wsStatus = useWebSocket(account?.publicKey ?? null, handleWsMessage);
  const { status: networkStatus } = useNetworkStatus();
  const { rate: xlmUsdRate, loading: rateLoading } = useExchangeRate(lastWsMessage);

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        if (loading !== 'create') createAccount();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        if (loading !== 'balance') checkBalance();
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
  }, [loading, showShortcuts]);

  // Listen for SW notification that we're back online with queued payments
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onSwMessage = (e) => {
      if (e.data?.type === 'REPLAY_QUEUED_PAYMENTS') setShowReplayPrompt(true);
    };
    navigator.serviceWorker.addEventListener('message', onSwMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onSwMessage);
  }, []);

  // Load label from backend when account is restored from persisted state
  useEffect(() => {
    if (account?.publicKey && !accountLabel) loadLabel(account.publicKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.publicKey]);

  // Deep-link: open tx lookup when URL contains #tx=<hash>
  useEffect(() => {
    const match = window.location.hash.match(/^#tx=(.+)$/);
    if (match) {
      setDeepLinkHash(match[1]);
      setShowTxLookup(true);
    }
  }, []);

  const resetForm = () => dispatch({ type: A.RESET_FORM });
  const clearForm = () => {
    if (recipient || amount) { setConfirmClear(true); return; }
    resetForm();
  };
  const confirmClearYes = () => { setConfirmClear(false); resetForm(); };
  const confirmClearNo  = () => setConfirmClear(false);

  const replayQueued = async () => {
    if (!replaySecret) return;
    setShowReplayPrompt(false);
    let anyFailed = false;
    for (const item of pendingItems) {
      try {
        await withTimeout(signal => axios.post('/api/stellar/payment/send', {
          sourceSecret: replaySecret,
          destination: item.destination,
          amount: item.amount,
          assetCode: item.assetCode,
        }, { signal }));
        await dequeue(item.id);
      } catch (error) {
        anyFailed = true;
        logError(error, { context: 'replayQueued' });
      }
    }
    setReplaySecret('');
    if (anyFailed) msg.error('Some queued payments failed to send. Please retry.');
    else { msg.success('All queued payments sent.'); checkBalance(); }
  };

  const loadLabel = useCallback(async (publicKey) => {
    try {
      const { data } = await axios.get(`/api/stellar/account/${publicKey}/label`);
      dispatch({ type: A.SET_LABEL, payload: data.accountLabel ?? '' });
    } catch { /* non-critical */ }
  }, [dispatch]);

  const fetchKycStatus = useCallback(async () => {
    if (!account?.publicKey) {
      setKycStatus(null);
      return;
    }

    setKycLoading(true);
    try {
      const { data } = await axios.get('/api/compliance/kyc/status');
      setKycStatus(data.status);
      setKycError(null);
    } catch (error) {
      if (error.response?.status === 404) {
        setKycStatus(null);
      } else {
        setKycError(error.response?.data?.error || 'Failed to load KYC status');
        setKycStatus(null);
      }
    } finally {
      setKycLoading(false);
    }
  }, [account?.publicKey]);

  useEffect(() => {
    fetchKycStatus();
    // Check if user has admin role from JWT token
    const token = localStorage.getItem('authToken');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUserRole(payload.role);
      } catch (e) {
        // Invalid token format
      }
    }
  }, [fetchKycStatus]);

  const saveLabel = async () => {
    if (!account) return;
    try {
      await axios.put(`/api/stellar/account/${account.publicKey}/label`, { accountLabel: labelDraft });
      dispatch({ type: A.SET_LABEL, payload: labelDraft });
      setEditingLabel(false);
    } catch (error) {
      msg.error('Failed to save label');
    }
  };

  const createAccount = async () => {
    dispatch({ type: A.SET_LOADING, payload: 'create' });
    try {
      const { data } = await withTimeout(signal => axios.post('/api/stellar/account/create', null, { signal }));
      dispatch({ type: A.SET_ACCOUNT, payload: data });
      dispatch({ type: A.SET_LABEL, payload: '' });
      resetForm();
      setShowCelebration(true);
    } catch (error) {
      logError(error, { context: 'createAccount' });
      msg.error(getFriendlyError(error), { retry: createAccount });
    } finally { dispatch({ type: A.SET_LOADING, payload: '' }); }
  };

  const importAccount = async (secretKey) => {
    dispatch({ type: A.SET_LOADING, payload: 'import' });
    try {
      const { data } = await withTimeout(signal => axios.post('/api/stellar/account/import', { secretKey }, { signal }));
      dispatch({ type: A.SET_ACCOUNT, payload: data });
      dispatch({ type: A.SET_SHOW_IMPORT, payload: false });
      await loadLabel(data.publicKey);
      msg.success('Account imported successfully!');
    } catch (error) {
      logError(error, { context: 'importAccount' });
      msg.error(getFriendlyError(error));
    } finally { dispatch({ type: A.SET_LOADING, payload: '' }); }
  };

  const checkBalance = async () => {
    if (!account) return;
    dispatch({ type: A.SET_LOADING, payload: 'balance' });
    try {
      const { data } = await withTimeout(signal => axios.get(`/api/stellar/account/${account.publicKey}`, { signal }));
      dispatch({ type: A.SET_BALANCE, payload: data });
    } catch (error) {
      logError(error, { context: 'checkBalance' });
      msg.error(getFriendlyError(error), { retry: checkBalance });
    } finally { dispatch({ type: A.SET_LOADING, payload: '' }); }
  };

  const recipientValid = isValidStellarAddress(recipient);
  const recipientTouched = recipient.length > 0;
  const xlmBalance = balance?.balances?.find(b => b.asset === 'XLM')?.balance ?? null;
  const amountTouched = amount.length > 0;
  const amountError = validateAmount(amount, xlmBalance !== null ? parseFloat(xlmBalance) : null);
  const amountValid = amountTouched && !amountError;
  const largeTransactionBlocked = amountValid && kycStatus !== 'APPROVED' && parseFloat(amount) > KYC_LARGE_TRANSACTION_LIMIT;

  const handleSendMax = () => {
    if (xlmBalance === null) return;
    const maxSendable = Math.max(0, parseFloat(xlmBalance) - 1 - 0.00001);
    dispatch({ type: A.SET_AMOUNT, payload: maxSendable.toFixed(7).replace(/\.?0+$/, '') });
  };

  const sendPayment = async () => {
    if (!account || !recipientValid || !amountValid) return;
    if (kycStatus !== 'APPROVED' && parseFloat(amount) > KYC_LARGE_TRANSACTION_LIMIT) {
      msg.error(`Large transactions above ${KYC_LARGE_TRANSACTION_LIMIT} XLM require approved KYC.`);
      return;
    }

    dispatch({ type: A.SET_LOADING, payload: 'send' });
    const payload = { sourceSecret: account.secretKey, destination: recipient, amount, assetCode: 'XLM', memo: memo || undefined, memoType: memo ? memoType : undefined };

    // Optimistic balance update
    if (xlmBalance !== null) {
      const optimisticBalances = balance.balances.map(b =>
        b.asset === 'XLM' ? { ...b, balance: String((parseFloat(b.balance) - parseFloat(amount) - 0.00001).toFixed(7)) } : b
      );
      dispatch({ type: A.SET_BALANCE_OPTIMISTIC, payload: { balances: optimisticBalances } });
    }

    try {
      const { data } = await withTimeout(signal => axios.post('/api/stellar/payment/send', payload, { signal }));
      msg.success(`Payment sent! Hash: ${data.hash.slice(0, 8)}…`, { hash: data.hash });
      resetForm();
      checkBalance();
    } catch (error) {
      dispatch({ type: A.REVERT_BALANCE });
      if (!navigator.onLine) {
        await queueOffline({ destination: payload.destination, amount: payload.amount, assetCode: payload.assetCode });
        msg.info('You are offline. Payment queued — you\'ll be prompted to re-enter your secret key when back online.');
      } else {
        logError(error, { context: 'sendPayment' });
        msg.error(getFriendlyError(error), { retry: sendPayment });
      }
    } finally { dispatch({ type: A.SET_LOADING, payload: '' }); }
  };

  return (
    <>
      <a href="#main-content" className="skip-link">Skip to main content</a>

      {/* Account creation celebration overlay */}
      <AccountCreatedCelebration
        visible={showCelebration}
        onDone={() => {
          setShowCelebration(false);
          msg.success('Account created! Save your secret key securely.');
        }}
        reducedMotion={prefersReduced}
      />

      <div className="app">
        <NetworkStatusBanner />
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {loading === 'create' && 'Creating account…'}
          {loading === 'balance' && 'Checking balance…'}
          {loading === 'send' && 'Sending payment…'}
          {loading === 'import' && 'Importing account…'}
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
              <li><kbd>Ctrl+B</kbd> Check balance</li>
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
            <div>
              <h1>Stellar Remittance Platform</h1>
              {account && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  {editingLabel ? (
                    <>
                      <input
                        type="text"
                        value={labelDraft}
                        onChange={(e) => setLabelDraft(e.target.value.slice(0, 50))}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveLabel(); if (e.key === 'Escape') setEditingLabel(false); }}
                        placeholder="Add a nickname…"
                        maxLength={50}
                        aria-label="Account nickname"
                        style={{ fontSize: '0.85rem', padding: '2px 6px' }}
                        autoFocus
                      />
                      <button type="button" onClick={saveLabel} style={{ fontSize: '0.8rem' }} aria-label="Save nickname">Save</button>
                      <button type="button" onClick={() => setEditingLabel(false)} style={{ fontSize: '0.8rem' }} aria-label="Cancel editing nickname">Cancel</button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setLabelDraft(accountLabel); setEditingLabel(true); }}
                      style={{ fontSize: '0.85rem', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', textDecoration: 'underline dotted' }}
                      aria-label={accountLabel ? `Account nickname: ${accountLabel}. Click to edit.` : 'Add account nickname'}
                    >
                      {accountLabel || `${account.publicKey.slice(0, 6)}…${account.publicKey.slice(-4)}`}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                className="theme-toggle-btn"
                onClick={toggleTheme}
                aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
              >
                {isDark ? '☀️ Light' : '🌙 Dark'}
              </button>
              <LanguageSelector />
              {canInstall && (
                <button type="button" className="pwa-install-btn" onClick={install} aria-label="Install app">
                  ⬇ Install
                </button>
              )}
              {!pushEnabled && 'Notification' in window && (
                <button type="button" className="pwa-install-btn" onClick={() => enablePush(account?.publicKey)} aria-label="Enable push notifications">
                  🔔 Notify
                </button>
              )}
              <button
                type="button"
                className="shortcuts-help-btn"
                onClick={() => dispatch({ type: A.SET_SHOW_SHORTCUTS, payload: !showShortcuts })}
                aria-label="Show keyboard shortcuts"
                aria-expanded={showShortcuts}
                aria-controls="shortcuts-panel"
              >
                ⌨
              </button>
              <button
                type="button"
                className="shortcuts-help-btn"
                onClick={() => { setDeepLinkHash(''); setShowTxLookup(true); }}
                aria-label="Look up transaction by hash"
                title="Look up transaction by hash"
              >
                🔍
              </button>
              <NotificationBell />
              {account && (
                <button
                  type="button"
                  className="shortcuts-help-btn"
                  onClick={() => setShowSettings(true)}
                  aria-label="Account settings"
                  title="Account settings"
                >
                  ⚙️
                </button>
              )}
              <NetworkBadge status={networkStatus} />
              <motion.span
                animate={{ opacity: [0.6, 1, 0.6] }}
                transition={{ repeat: Infinity, duration: 2 }}
                style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6 }}
                aria-label={`WebSocket status: ${wsStatus}`}
                role="status"
              >
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: `var(--ws-${wsStatus})`, display: 'inline-block' }} aria-hidden="true" />
                <span aria-hidden="true">{wsStatus}</span>
              </motion.span>
            </div>
          </div>

          <AnimatePresence>
            {updateAvailable && (
              <motion.div className="pwa-banner pwa-banner--update" role="status" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
                <span>A new version is available.</span>
                <button type="button" className="pwa-banner__btn" onClick={applyUpdate}>Update now</button>
              </motion.div>
            )}
          </AnimatePresence>
        </header>

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
                <button type="button" className="qr-close" onClick={() => dispatch({ type: A.SET_SHOW_SHORTCUTS, payload: false })} aria-label="Close keyboard shortcuts">✕</button>
              </div>
              <ul className="shortcuts-list">
                <li><kbd>Ctrl+N</kbd> Create new account</li>
                <li><kbd>Ctrl+B</kbd> Check balance</li>
                <li><kbd>Ctrl+C</kbd> Copy key (when copy button focused)</li>
                <li><kbd>Escape</kbd> Close modals</li>
                <li><kbd>?</kbd> Toggle this help</li>
                <li><kbd>Tab</kbd> Navigate between fields</li>
                <li><kbd>Enter</kbd> Submit focused form</li>
              </ul>
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
                aria-busy={loading === 'create'}
                aria-label="Create new Stellar account (Ctrl+N)"
              >
                {loading === 'create' ? <Spinner label="Creating account…" /> : 'Create Account'}
              </motion.button>
              <motion.button
                onClick={() => dispatch({ type: A.SET_SHOW_IMPORT, payload: !showImportForm })}
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
                    onKeyDown={(e) => e.key === 'Enter' && setShowConfirm(true)}
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
                    onKeyDown={(e) => e.key === 'Enter' && setShowConfirm(true)}
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
                {amountValid && (xlmUsdRate
                  ? <p className="rate-estimate" aria-live="polite">
                      ≈ ${(parseFloat(amount) * xlmUsdRate).toFixed(2)} USD
                      <span className="rate-source"> · live rate</span>
                    </p>
                  : rateLoading && <p className="rate-estimate rate-estimate--loading" aria-live="polite">Loading rate…</p>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <motion.button onClick={sendPayment} {...tap} disabled={!recipientValid || !amountValid || loading === 'send'}>
                    {loading === 'send' ? <Spinner label="Sending payment..." /> : 'Send'}
                  </motion.button>
                  {confirmClear ? (
                    <span className="confirm-clear" role="group" aria-label="Confirm clear form">
                      <span className="confirm-clear__label">Clear form?</span>
                      <button type="button" className="confirm-clear__yes" onClick={confirmClearYes} aria-label="Yes, clear the form">Yes</button>
                      <button type="button" className="confirm-clear__no"  onClick={confirmClearNo}  aria-label="No, keep the form">No</button>
                    </span>
                  ) : (
                    <motion.button
                      className="btn-clear"
                      onClick={clearForm}
                      {...tap}
                      disabled={loading === 'send' || (!recipient && !amount)}
                      aria-label="Clear payment form"
                    >
                      Clear
                    </motion.button>
                  )}
                </div>
              </ErrorBoundary>
            </motion.div>

            <AnimatePresence>
              {account && (
                <motion.div className="account-info" variants={v.pop} initial="hidden" animate="visible" exit="exit" aria-label="Account details">
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
                  <motion.button
                    className="qr-trigger"
                    onClick={() => dispatch({ type: A.SET_SHOW_QR, payload: true })}
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
                            <span className="balance-asset">
                              {b.asset}
                              {b.asset === 'XLM' && <XLMInfoIcon />}
                            </span>
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
                    <AddressBook
                      onSelect={(address) => dispatch({ type: A.SET_RECIPIENT, payload: address })}
                      prefillAddress={recipient}
                    />
                    <div className="input-wrap">
                      <label htmlFor="recipient-input" className="sr-only">Recipient public key</label>
                      <input
                        id="recipient-input"
                        type="text"
                        placeholder="Recipient Public Key"
                        value={recipient}
                        onChange={(e) => dispatch({ type: A.SET_RECIPIENT, payload: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && sendPayment()}
                        style={{ border: `2px solid ${recipientTouched ? (recipientValid ? '#22c55e' : '#ef4444') : '#ccc'}` }}
                        aria-invalid={recipientTouched && !recipientValid}
                        aria-describedby={recipientTouched && !recipientValid ? 'recipient-error' : undefined}
                        autoComplete="off"
                      />
                      {recipientTouched && <span className="input-icon" aria-hidden="true">{recipientValid ? '✅' : '❌'}</span>}
                      <button
                        type="button"
                        className="qr-scan-btn"
                        onClick={() => setShowScanner(true)}
                        aria-label="Scan QR code to fill recipient address"
                        title="Scan QR"
                      >
                        📷
                      </button>
                    </div>
                    <AnimatePresence>
                      {showScanner && (
                        <QRScanner
                          onScan={(address) => {
                            dispatch({ type: A.SET_RECIPIENT, payload: address });
                            setShowScanner(false);
                          }}
                          onClose={() => setShowScanner(false)}
                        />
                      )}
                    </AnimatePresence>
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
                        onChange={(e) => dispatch({ type: A.SET_AMOUNT, payload: formatAmount(e.target.value) })}
                        onKeyDown={(e) => e.key === 'Enter' && sendPayment()}
                        style={{ border: `2px solid ${amountTouched ? (amountValid ? '#22c55e' : '#ef4444') : '#ccc'}` }}
                        aria-invalid={amountTouched && !!amountError}
                        aria-describedby={amountTouched && amountError ? 'amount-error' : undefined}
                      />
                      {amountTouched && <span className="input-icon" aria-hidden="true">{amountValid ? '✅' : '❌'}</span>}
                      <motion.button
                        type="button"
                        className="btn-send-max"
                        onClick={handleSendMax}
                        {...tap}
                        disabled={xlmBalance === null || loading === 'send'}
                        aria-label="Send maximum available amount"
                      >
                        Max
                      </motion.button>
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '-8px', marginBottom: '8px' }}>
                      <XLMInfoIcon /> XLM is the native Stellar currency
                    </div>
                    <AnimatePresence>
                      {amountTouched && amountError && (
                        <motion.p id="amount-error" className="field-error" role="alert" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
                          {amountError}
                        </motion.p>
                      )}
                    </AnimatePresence>

                    <div className="input-wrap">
                      <label htmlFor="memo-input" className="sr-only">Payment memo (optional)</label>
                      <label htmlFor="memo-type-select" className="sr-only">Memo type</label>
                      <select
                        id="memo-type-select"
                        value={memoType}
                        onChange={(e) => dispatch({ type: A.SET_MEMO_TYPE, payload: e.target.value })}
                        aria-label="Memo type"
                        style={{ flexShrink: 0 }}
                      >
                        <option value="text">Text</option>
                        <option value="id">ID (exchange)</option>
                      </select>
                      <label htmlFor="memo-input" className="sr-only">
                        {memoType === 'id' ? 'Numeric memo ID (required for exchange deposits)' : 'Payment memo (optional, max 28 characters)'}
                      </label>
                      <input
                        id="memo-input"
                        type={memoType === 'id' ? 'number' : 'text'}
                        inputMode={memoType === 'id' ? 'numeric' : undefined}
                        placeholder={memoType === 'id' ? 'Numeric memo ID (exchange deposit)' : 'Memo (optional, max 28 chars)'}
                        value={memo}
                        onChange={(e) => {
                          const val = memoType === 'id'
                            ? e.target.value.replace(/\D/g, '').slice(0, 20)
                            : e.target.value.slice(0, 28);
                          dispatch({ type: A.SET_MEMO, payload: val });
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && sendPayment()}
                        aria-label={memoType === 'id' ? 'Numeric memo ID for exchange deposit' : 'Payment memo (optional)'}
                        maxLength={memoType === 'id' ? 20 : 28}
                      />
                      {memo && memoType === 'text' && <span className="input-icon" aria-hidden="true">{memo.length}/28</span>}
                    </div>

                    <FeeDisplay amount={amount} visible={amountValid} />
                    {amountValid && (xlmUsdRate
                      ? <p className="rate-estimate" aria-live="polite">
                          ≈ ${(parseFloat(amount) * xlmUsdRate).toFixed(2)} USD
                          <span className="rate-source"> · live rate</span>
                        </p>
                      : rateLoading && <p className="rate-estimate rate-estimate--loading" aria-live="polite">Loading rate…</p>
                    )}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <motion.button
                        onClick={() => setShowConfirm(true)}
                        {...tap}
                        disabled={!recipientValid || !amountValid || loading === 'send' || largeTransactionBlocked}
                        aria-busy={loading === 'send'}
                        aria-label="Send XLM payment"
                      >
                        {loading === 'send' ? <Spinner label="Sending payment…" /> : 'Send'}
                      </motion.button>
                      {largeTransactionBlocked && (
                        <p style={{ color: '#b45309', margin: '0 0 0 12px', fontSize: '0.9rem' }}>
                          Large transactions above {KYC_LARGE_TRANSACTION_LIMIT} XLM<XLMInfoIcon /> require approved KYC.
                        </p>
                      )}
                      <InlineConfirmation
                        isVisible={confirmClear}
                        message="Clear form?"
                        onConfirm={confirmClearYes}
                        onCancel={confirmClearNo}
                        confirmText="Yes"
                        cancelText="No"
                      />
                      {!confirmClear && (
                        <motion.button
                          className="btn-clear"
                          onClick={clearForm}
                          {...tap}
                          disabled={loading === 'send' || (!recipient && !amount)}
                          aria-label="Clear payment form"
                        >
                          Clear
                        </motion.button>
                      )}
                    </div>
                  </ErrorBoundary>
                </motion.section>

                {/* File Upload */}
                <motion.section className="section" variants={v.fadeSlide}>
                  <h2 className="sr-only">File Upload</h2>
                  <FileUpload />
                </motion.section>

                {/* Transaction History */}
                <motion.div variants={v.fadeSlide}>
                  <TransactionHistory publicKey={account.publicKey} />
                </motion.div>

                {/* Stream Payments */}
                <motion.div variants={v.fadeSlide}>
                  <StreamPayment publicKey={account.publicKey} />
                </motion.div>

                {/* Asset Conversion Calculator */}
                <motion.div variants={v.fadeSlide}>
                  <ConvertWidget />
                </motion.div>

                {/* AMM Pool Browser */}
                <motion.div variants={v.fadeSlide}>
                  <AMMPoolBrowser />
                </motion.div>

                {/* Account Recovery */}
                <motion.div variants={v.fadeSlide}>
                  <AccountRecovery />
                {/* Settings Sections Tabs */}
                <motion.section className="section" variants={v.fadeSlide}>
                  <h2 style={{ marginBottom: 16 }}>Advanced Features</h2>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                    {[
                      { id: 'multisig', label: '🔐 Multi-Sig' },
                      { id: 'kyc', label: '📋 KYC' },
                      { id: 'notifications', label: '🔔 Notifications' },
                      { id: 'backup', label: '💾 Backup', action: () => setShowBackupSettings(true) },
                      ...(userRole === 'admin' ? [{ id: 'compliance', label: '🛡️ Compliance', action: () => setShowComplianceDashboard(true) }] : []),
                    ].map((section) => (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => {
                          if (section.action) {
                            section.action();
                          } else {
                            setActiveSettingsSection(activeSettingsSection === section.id ? null : section.id);
                          }
                        }}
                        style={{
                          padding: '10px 16px',
                          background: activeSettingsSection === section.id ? '#2563eb' : '#f3f4f6',
                          color: activeSettingsSection === section.id ? '#fff' : '#333',
                          border: 'none',
                          borderRadius: 4,
                          cursor: 'pointer',
                          fontWeight: 500,
                          transition: 'all 0.2s',
                        }}
                      >
                        {section.label}
                      </button>
                    ))}
                  </div>

                  <AnimatePresence mode="wait">
                    {activeSettingsSection === 'multisig' && (
                      <motion.div key="multisig" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
                        <MultiSigTransactions publicKey={account.publicKey} />
                      </motion.div>
                    )}
                    {activeSettingsSection === 'kyc' && (
                      <motion.div key="kyc" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
                        <KYCForm />
                      </motion.div>
                    )}
                    {activeSettingsSection === 'notifications' && (
                      <motion.div key="notifications" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
                        <NotificationPreferences />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.section>
                {/* Path Payment */}
                <motion.div variants={v.fadeSlide}>
                  <PathPayment account={account} />
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
            <QRCodeModal publicKey={account.publicKey} onClose={() => dispatch({ type: A.SET_SHOW_QR, payload: false })} />
          )}
        </AnimatePresence>

        {/* Offline replay prompt */}
        <AnimatePresence>
          {showReplayPrompt && pendingCount > 0 && (
            <motion.div
              className="replay-modal-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="replay-title"
              variants={v.pop} initial="hidden" animate="visible" exit="exit"
            >
              <div className="replay-modal">
                <h2 id="replay-title">Send queued payments</h2>
                <p>
                  You have {pendingCount} queued payment{pendingCount > 1 ? 's' : ''} waiting to be sent.
                  Enter your secret key to authorise {pendingCount > 1 ? 'them' : 'it'}.
                </p>
                <label htmlFor="replay-secret" className="sr-only">Secret key</label>
                <input
                  id="replay-secret"
                  type="password"
                  placeholder="Secret key (S…)"
                  value={replaySecret}
                  onChange={(e) => setReplaySecret(e.target.value)}
                  autoComplete="off"
                  aria-describedby="replay-secret-hint"
                />
                <p id="replay-secret-hint" className="replay-modal__hint">
                  Your key is used only in memory to sign these transactions and is never stored.
                </p>
                <div className="replay-modal__actions">
                  <button type="button" onClick={replayQueued} disabled={!replaySecret} aria-label="Send queued payments">
                    Send now
                  </button>
                  <button
                    type="button"
                    className="btn-clear"
                    onClick={() => { setShowReplayPrompt(false); setReplaySecret(''); }}
                    aria-label="Dismiss, send later"
                  >
                    Later
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <ConfirmSendDialog
          open={showConfirm}
          recipient={recipient}
          amount={amount}
          asset="XLM"
          onConfirm={() => { setShowConfirm(false); sendPayment(); }}
          onCancel={() => setShowConfirm(false)}
        />

        <AnimatePresence>
          {showTxLookup && (
            <TxLookup
              initialHash={deepLinkHash}
              accountPublicKey={account?.publicKey ?? ''}
              onClose={() => { setShowTxLookup(false); setDeepLinkHash(''); }}
            />
          )}
        </AnimatePresence>

        {showSettings && account && (
          <AccountSettings
            publicKey={account.publicKey}
            onClose={() => setShowSettings(false)}
          />
        )}

        {showComplianceDashboard && (
          <ComplianceDashboard onClose={() => setShowComplianceDashboard(false)} />
        )}

        {showBackupSettings && (
          <BackupSettings onClose={() => setShowBackupSettings(false)} />
        )}
      </div>
    </>
  );
}

export default App;
