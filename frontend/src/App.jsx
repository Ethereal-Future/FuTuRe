import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import apiClient from './api/client.js';
import { getKycStatus } from './api/compliance.js';
import {
  createAccount as createStellarAccount,
  importAccount as importStellarAccount,
  getAccount,
  getAccountLabel,
  updateAccountLabel,
  sendPayment as sendStellarPayment,
  createTrustline,
  batchPayment,
} from './api/stellar.js';
import { verifyRecoveryCode, getMFAStatus } from './api/auth.js';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { isValidStellarAddress } from './utils/validateStellarAddress';
import { validateAmount, formatAmount } from './utils/validateAmount';
import { getFriendlyError } from './utils/errorMessages';
import { formatBalanceWithAsset } from './utils/formatBalance';
import { useWebSocket } from './hooks/useWebSocket';
import { useMessages } from './hooks/useMessages';
import { usePWA } from './hooks/usePWA';
import { useOfflineQueue } from './hooks/useOfflineQueue';
import { useRTL } from './hooks/useRTL';
import { makeVariants, tapScale } from './utils/animations';
import { ErrorBoundary } from './components/ErrorBoundary';
import { QRCodeModal } from './components/QRCodeModal';
import { PaymentConfirmationModal } from './components/PaymentConfirmationModal';
import { QRScanner } from './components/QRScanner';
import { NetworkBadge } from './components/NetworkBadge';
import { NetworkStatusBanner } from './components/NetworkStatusBanner';
import { OfflineIndicator } from './components/OfflineIndicator';
import { StatusMessage } from './components/StatusMessage';
import { CopyButton } from './components/CopyButton';
import { Spinner } from './components/Spinner';
import { SkeletonBalance } from './components/Skeleton';
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
import { NotificationPreferences } from './components/NotificationPreferences';
import { NotificationBell } from './components/NotificationBell';
import { InstallBanner } from './components/InstallBanner';
import { useTheme } from './contexts/ThemeContext';
import { useAppState, useAppDispatch, A } from './store/index.js';
import { useExchangeRate } from './hooks/useExchangeRate';
import { useBalance, useSendPayment, useCreateAccount, useImportAccount, useKycStatus, useSaveAccountLabel, useNetworkStatusQuery } from './hooks/useQueryHooks';
import {
  useBalance,
  useSendPayment,
  useCreateAccount,
  useImportAccount,
  useKycStatus,
  useSaveAccountLabel,
  useNetworkStatusQuery,
} from './hooks/useQueryHooks';
import { AMMPoolBrowser } from './components/AMMPoolBrowser';
import { ConvertWidget } from './components/ConvertWidget';
import { XLMInfoIcon } from './components/XLMInfoIcon';

// Heavy components loaded on-demand to keep the initial bundle small
const AMMPoolBrowser = lazy(() =>
  import('./components/AMMPoolBrowser').then((m) => ({ default: m.AMMPoolBrowser }))
);
const AccountRecovery = lazy(() =>
  import('./components/AccountRecovery').then((m) => ({ default: m.AccountRecovery }))
);
const MultiSigTransactions = lazy(() =>
  import('./components/MultiSigTransactions').then((m) => ({ default: m.MultiSigTransactions }))
);
const KYCForm = lazy(() => import('./components/KYCForm').then((m) => ({ default: m.KYCForm })));
const ComplianceDashboard = lazy(() =>
  import('./components/ComplianceDashboard').then((m) => ({ default: m.ComplianceDashboard }))
);
const BackupSettings = lazy(() =>
  import('./components/BackupSettings').then((m) => ({ default: m.BackupSettings }))
);

const KYC_LARGE_TRANSACTION_LIMIT = 1000;

function App() {
  const {
    account,
    balance,
    loading,
    recipient,
    amount,
    assetCode,
    memo,
    memoType,
    showQR,
    showImportForm,
    showShortcuts,
    accountLabel,
  } = useAppState();
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

  const { t } = useTranslation();
  const msg = useMessages();
  const {
    canInstall,
    install,
    isDismissed,
    dismissInstall,
    updateAvailable,
    applyUpdate,
    pushEnabled,
    enablePush,
  } = usePWA();
  const { queue: queueOffline, dequeue, pendingItems, pendingCount } = useOfflineQueue();
  const [showTxLookup, setShowTxLookup] = useState(false);
  const [deepLinkHash, setDeepLinkHash] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [lastWsMessage, setLastWsMessage] = useState(null);
  const [activeSettingsSection, setActiveSettingsSection] = useState(null); // null, 'multisig', 'kyc', 'notifications'
  const [showPaymentConfirmation, setShowPaymentConfirmation] = useState(false);
  const [trustlineAsset, setTrustlineAsset] = useState(null);
  const [trustlineLoading, setTrustlineLoading] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [batchRecipients, setBatchRecipients] = useState([]);
  const [showRecoveryCodeEntry, setShowRecoveryCodeEntry] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const { isDark, toggleTheme } = useTheme();
  useRTL();
  const prefersReduced = useReducedMotion();
  const v = makeVariants(prefersReduced);
  const tap = tapScale(prefersReduced);

  const handleWsMessage = useCallback(
    (wsMsg) => {
      setLastWsMessage(wsMsg);
      if (wsMsg.type === 'transaction') {
        const text =
          wsMsg.direction === 'received'
            ? `📥 Received ${wsMsg.amount} ${wsMsg.assetCode} — tx: ${wsMsg.hash?.slice(0, 8)}…`
            : `📤 Sent ${wsMsg.amount} ${wsMsg.assetCode} — tx: ${wsMsg.hash?.slice(0, 8)}…`;
        msg.info(text);
        if (wsMsg.balance) dispatch({ type: A.SET_BALANCE, payload: { balances: wsMsg.balance } });
      }
    },
    [msg, dispatch]
  );

  const wsStatus = useWebSocket(account?.publicKey ?? null, handleWsMessage);
  const { status: networkStatus } = useNetworkStatusQuery();

  // Load user's preferred fiat currency from account settings (defaultAsset)
  const [fiatCurrency, setFiatCurrency] = useState('USD');
  useEffect(() => {
    if (!account?.publicKey) return;
    apiClient.get(`/api/stellar/account/${account.publicKey}/settings`)
      .then(({ data }) => {
        const asset = data?.defaultAsset;
        // Use defaultAsset as fiat currency if it's not a Stellar asset (XLM/USDC/etc.)
        const STELLAR_ASSETS = new Set(['XLM', 'USDC', 'EURC']);
        if (asset && !STELLAR_ASSETS.has(asset)) setFiatCurrency(asset);
        else if (asset === 'EURC') setFiatCurrency('EUR');
      })
      .catch(() => { /* use USD default */ });
  }, [account?.publicKey]);

  const { rate: xlmFiatRate, loading: rateLoading } = useExchangeRate(lastWsMessage, fiatCurrency);

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
  }, [loading, showShortcuts, createAccount, checkBalance, dispatch]);

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
  }, [account?.publicKey, accountLabel, loadLabel]);

  // Update document.title based on the active section
  useEffect(() => {
    if (showSettings) {
      document.title = t('page.settings');
    } else if (showTxLookup) {
      document.title = t('page.txLookup');
    } else if (showComplianceDashboard) {
      document.title = t('page.compliance');
    } else {
      document.title = t('page.dashboard');
    }
  }, [showSettings, showTxLookup, showComplianceDashboard, t]);

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
    if (recipient || amount) {
      setConfirmClear(true);
      return;
    }
    resetForm();
  };
  const confirmClearYes = () => {
    setConfirmClear(false);
    resetForm();
  };
  const confirmClearNo = () => setConfirmClear(false);

  const replayQueued = async () => {
    if (!replaySecret) return;
    setShowReplayPrompt(false);
    let anyFailed = false;
    for (const item of pendingItems) {
      try {
        await sendStellarPayment({
          sourceSecret: replaySecret,
          destination: item.destination,
          amount: item.amount,
          assetCode: item.assetCode,
        });
        await dequeue(item.id);
      } catch (error) {
        anyFailed = true;
        logError(error, { context: 'replayQueued' });
      }
    }
    setReplaySecret('');
    if (anyFailed) msg.error('Some queued payments failed to send. Please retry.');
    else {
      msg.success('All queued payments sent.');
      checkBalance();
    }
  };

  const loadLabel = useCallback(async (publicKey) => {
    try {
      const fetchedLabel = await getAccountLabel(publicKey);
      dispatch({ type: A.SET_LABEL, payload: fetchedLabel });
    } catch { /* non-critical */ }
  }, [dispatch]);
  const loadLabel = useCallback(
    async (publicKey) => {
      try {
        const accountLabel = await getAccountLabel(publicKey);
        dispatch({ type: A.SET_LABEL, payload: accountLabel });
      } catch {
        /* non-critical */
      }
    },
    [dispatch]
  );

  const fetchKycStatus = useCallback(async () => {
    if (!account?.publicKey) {
      setKycStatus(null);
      return;
    }

    setKycLoading(true);
    try {
      const status = await getKycStatus();
      setKycStatus(status);
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
      await updateAccountLabel(account.publicKey, labelDraft);
      dispatch({ type: A.SET_LABEL, payload: labelDraft });
      setEditingLabel(false);
    } catch (error) {
      msg.error('Failed to save label');
    }
  };

  const createAccount = useCallback(async () => {
    dispatch({ type: A.SET_LOADING, payload: 'create' });
    try {
      const data = await createStellarAccount();
      dispatch({ type: A.SET_ACCOUNT, payload: data });
      dispatch({ type: A.SET_LABEL, payload: '' });
      resetForm();
      setShowCelebration(true);
    } catch (error) {
      logError(error, { context: 'createAccount' });
      msg.error(getFriendlyError(error), { retry: createAccount });
    } finally { dispatch({ type: A.SET_LOADING, payload: '' }); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
    } finally {
      dispatch({ type: A.SET_LOADING, payload: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, msg]);

  const importAccount = async (secretKey) => {
    dispatch({ type: A.SET_LOADING, payload: 'import' });
    try {
      const data = await importStellarAccount(secretKey);
      dispatch({ type: A.SET_ACCOUNT, payload: data });
      dispatch({ type: A.SET_SHOW_IMPORT, payload: false });
      await loadLabel(data.publicKey);
      msg.success('Account imported successfully!');
    } catch (error) {
      logError(error, { context: 'importAccount' });
      msg.error(getFriendlyError(error));
    } finally {
      dispatch({ type: A.SET_LOADING, payload: '' });
    }
  };

  const checkBalance = useCallback(async () => {
    if (!account) return;
    dispatch({ type: A.SET_LOADING, payload: 'balance' });
    try {
      const data = await getAccount(account.publicKey);
      dispatch({ type: A.SET_BALANCE, payload: data });
    } catch (error) {
      logError(error, { context: 'checkBalance' });
      msg.error(getFriendlyError(error), { retry: checkBalance });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    } finally { dispatch({ type: A.SET_LOADING, payload: '' }); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
    } finally {
      dispatch({ type: A.SET_LOADING, payload: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, dispatch, msg]);

  const recipientValid = recipient.length === 56 && isValidStellarAddress(recipient);
  const recipientTouched = recipient.length > 0;
  const selectedBalance = balance?.balances?.find((b) => b.asset === assetCode)?.balance ?? null;
  const xlmBalance = balance?.balances?.find((b) => b.asset === 'XLM')?.balance ?? null;
  const amountTouched = amount.length > 0;
  const amountError = validateAmount(amount, selectedBalance !== null ? parseFloat(selectedBalance) : null);
  const amountValid = amountTouched && !amountError;
  const largeTransactionBlocked =
    amountValid && kycStatus !== 'APPROVED' && assetCode === 'XLM' && parseFloat(amount) > KYC_LARGE_TRANSACTION_LIMIT;

  const handleSendMax = () => {
    if (selectedBalance === null) return;
    const fee = assetCode === 'XLM' ? 1.00001 : 0; // fee only applies to XLM
    const maxSendable = Math.max(0, parseFloat(selectedBalance) - fee);
    dispatch({ type: A.SET_AMOUNT, payload: maxSendable.toFixed(7).replace(/\.?0+$/, '') });
  };

  const sendPayment = async () => {
    if (!account || !recipientValid || !amountValid) return;
    setShowPaymentConfirmation(true);
  };

  const confirmPayment = async () => {
    if (!account || !recipientValid || !amountValid) return;
    if (assetCode === 'XLM' && kycStatus !== 'APPROVED' && parseFloat(amount) > KYC_LARGE_TRANSACTION_LIMIT) {
      msg.error(
        `Large transactions above ${KYC_LARGE_TRANSACTION_LIMIT} XLM require approved KYC.`
      );
      return;
    }

    dispatch({ type: A.SET_LOADING, payload: 'send' });
    const payload = {
      sourceSecret: account.secretKey,
      destination: recipient,
      amount,
      assetCode,
      memo: memo || undefined,
      memoType: memo ? memoType : undefined,
    };

    // Optimistic balance update
    if (selectedBalance !== null) {
      const fee = assetCode === 'XLM' ? 0.00001 : 0;
      const optimisticBalances = balance.balances.map((b) =>
        b.asset === assetCode
          ? {
              ...b,
              balance: String((parseFloat(b.balance) - parseFloat(amount) - fee).toFixed(7)),
            }
          : b
      );
      dispatch({ type: A.SET_BALANCE_OPTIMISTIC, payload: { balances: optimisticBalances } });
    }

    try {
      const data = await sendStellarPayment(payload);
      msg.success(`Payment sent! Hash: ${data.hash.slice(0, 8)}…`, { hash: data.hash });
      resetForm();
      checkBalance();
      setShowPaymentConfirmation(false);
    } catch (error) {
      dispatch({ type: A.REVERT_BALANCE });
      if (error?.response?.data?.error?.code === 'KYC_REQUIRED' || error?.response?.data?.error === 'KYC_REQUIRED') {
        msg.error(
          `Large transactions above ${KYC_LARGE_TRANSACTION_LIMIT} XLM require approved KYC.`
        );
        setShowPaymentConfirmation(false);
        setActiveSettingsSection('kyc');
        setShowSettings(true);
      } else if (!navigator.onLine) {
        await queueOffline({
          destination: payload.destination,
          amount: payload.amount,
          assetCode: payload.assetCode,
        });
        msg.info(
          "You are offline. Payment queued — you'll be prompted to re-enter your secret key when back online."
        );
      } else {
        logError(error, { context: 'sendPayment' });
        msg.error(getFriendlyError(error), { retry: confirmPayment });
      }
    } finally {
      dispatch({ type: A.SET_LOADING, payload: '' });
    }
  };

  const handleCreateTrustline = async () => {
    if (!account || !trustlineAsset) return;
    
    setTrustlineLoading(true);
    try {
      await createTrustline(account.secretKey, trustlineAsset);
      msg.success(`Trustline created for ${trustlineAsset}!`);
      checkBalance();
      setTrustlineAsset(null);
    } catch (error) {
      logError(error, { context: 'createTrustline' });
      msg.error(getFriendlyError(error));
    } finally {
      setTrustlineLoading(false);
    }
  };

  const handleAssetChange = async (newAssetCode) => {
    dispatch({ type: A.SET_ASSET_CODE, payload: newAssetCode });
    
    // Check if non-native asset requires trustline
    if (newAssetCode !== 'XLM') {
      const hasTrustline = balance?.balances?.some((b) => b.asset === newAssetCode);
      if (!hasTrustline) {
        setTrustlineAsset(newAssetCode);
      }
    }
  };

  const addBatchRecipient = () => {
    if (!recipientValid || !amountValid) return;
    setBatchRecipients([...batchRecipients, { destination: recipient, amount, assetCode }]);
    dispatch({ type: A.SET_RECIPIENT, payload: '' });
    dispatch({ type: A.SET_AMOUNT, payload: '' });
  };

  const removeBatchRecipient = (index) => {
    setBatchRecipients(batchRecipients.filter((_, i) => i !== index));
  };

  const confirmBatchPayment = async () => {
    if (!account || batchRecipients.length === 0) return;
    
    dispatch({ type: A.SET_LOADING, payload: 'send' });
    const payload = {
      sourceSecret: account.secretKey,
      payments: batchRecipients,
      memo: memo || undefined,
      memoType: memo ? memoType : undefined,
    };

    // Optimistic balance update
    if (balance) {
      const optimisticBalances = balance.balances.map((b) => {
        const totalReduced = batchRecipients
          .filter((p) => p.assetCode === b.asset)
          .reduce((sum, p) => sum + parseFloat(p.amount), 0);
        const fee = b.asset === 'XLM' ? 0.00001 : 0;
        return {
          ...b,
          balance: String((parseFloat(b.balance) - totalReduced - fee).toFixed(7)),
        };
      });
      dispatch({ type: A.SET_BALANCE_OPTIMISTIC, payload: { balances: optimisticBalances } });
    }

    try {
      const data = await batchPayment(payload);
      msg.success(
        `Batch payment sent to ${batchRecipients.length} recipients! Hash: ${data.hash.slice(0, 8)}…`,
        { hash: data.hash }
      );
      setBatchRecipients([]);
      setBatchMode(false);
      resetForm();
      checkBalance();
      setShowPaymentConfirmation(false);
    } catch (error) {
      dispatch({ type: A.REVERT_BALANCE });
      logError(error, { context: 'batchPayment' });
      msg.error(getFriendlyError(error));
    } finally {
      dispatch({ type: A.SET_LOADING, payload: '' });
    }
  };

  const handleRecoveryCodeSubmit = async () => {
    if (!account) return;
    
    setShowRecoveryCodeEntry(false);
    try {
      const result = await verifyRecoveryCode(account.publicKey, recoveryCode);
      msg.success('Recovery code accepted! You are logged in.');
      setRecoveryCode('');
    } catch (error) {
      logError(error, { context: 'recovery-code' });
      msg.error(getFriendlyError(error));
      setShowRecoveryCodeEntry(true);
    }
  };

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Account creation celebration overlay */}
      <AccountCreatedCelebration
        visible={showCelebration}
        onDone={() => {
          setShowCelebration(false);
          msg.success('Account created! Save your secret key securely.');
        }}
        reducedMotion={prefersReduced}
      />

      <OfflineIndicator />
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
            <motion.div
              className="pwa-banner pwa-banner--update"
              role="status"
              variants={v.fadeSlide}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <span>A new version is available.</span>
              <button type="button" className="pwa-banner__btn" onClick={applyUpdate}>
                Update now
              </button>
            </motion.div>
          )}
          {canInstall && !isDismissed && (
            <InstallBanner onInstall={install} onDismiss={dismissInstall} />
          )}
        </AnimatePresence>
        {/* Keyboard shortcuts panel */}
        <AnimatePresence>
          {showShortcuts && (
            <motion.div
              className="shortcuts-panel"
              role="dialog"
              aria-modal="true"
              aria-label="Keyboard shortcuts"
              variants={v.pop}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <div className="shortcuts-panel__header">
                <strong>Keyboard Shortcuts</strong>
                <button
                  type="button"
                  className="qr-close"
                  onClick={() => dispatch({ type: A.SET_SHOW_SHORTCUTS, payload: false })}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <ul className="shortcuts-list">
                <li>
                  <kbd>Ctrl+N</kbd> Create new account
                </li>
                <li>
                  <kbd>Ctrl+B</kbd> Check balance
                </li>
                <li>
                  <kbd>Ctrl+C</kbd> Copy key (when copy button focused)
                </li>
                <li>
                  <kbd>Escape</kbd> Close modals
                </li>
                <li>
                  <kbd>?</kbd> Toggle this help
                </li>
                <li>
                  <kbd>Tab</kbd> Navigate between fields
                </li>
                <li>
                  <kbd>Enter</kbd> Submit focused form
                </li>
              </ul>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Create / Import Account */}
        <motion.div className="section" variants={v.fadeSlide} initial="hidden" animate="visible">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <motion.button
              onClick={createAccount}
              {...tap}
              disabled={loading === 'create'}
              title="Create account (Ctrl+N)"
            >
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
              <motion.div
                className="pwa-banner pwa-banner--queue"
                role="status"
                variants={v.fadeSlide}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                {pendingCount} payment{pendingCount > 1 ? 's' : ''} queued offline — will sync when
                back online.
              </motion.div>
            )}
          </AnimatePresence>

          <header>
            <div className="app-header-row">
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
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveLabel();
                            if (e.key === 'Escape') setEditingLabel(false);
                          }}
                          placeholder="Add a nickname…"
                          maxLength={50}
                          aria-label="Account nickname"
                          style={{ fontSize: '0.85rem', padding: '2px 6px' }}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={saveLabel}
                          style={{ fontSize: '0.8rem' }}
                          aria-label="Save nickname"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingLabel(false)}
                          style={{ fontSize: '0.8rem' }}
                          aria-label="Cancel editing nickname"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setLabelDraft(accountLabel);
                          setEditingLabel(true);
                        }}
                        style={{
                          fontSize: '0.85rem',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          color: 'inherit',
                          textDecoration: 'underline dotted',
                        }}
                        aria-label={
                          accountLabel
                            ? `Account nickname: ${accountLabel}. Click to edit.`
                            : 'Add account nickname'
                        }
                      >
                        {accountLabel ||
                          `${account.publicKey.slice(0, 6)}…${account.publicKey.slice(-4)}`}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="header-actions">
                <button
                  type="button"
                  className="theme-toggle-btn"
                  onClick={toggleTheme}
                  aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
                  title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
                >
                  {isDark ? '☀️ Light' : '🌙 Dark'}
                </button>
                <LanguageSelector />
                {!pushEnabled && 'Notification' in window && (
                  <button
                    type="button"
                    className="pwa-install-btn"
                    onClick={() => enablePush(account?.publicKey)}
                    aria-label="Enable push notifications"
                    title="Enable push notifications"
                  >
                    🔔 Notify
                  </button>
                )}
                <button
                  type="button"
                  className="shortcuts-help-btn"
                  onClick={() => dispatch({ type: A.SET_SHOW_SHORTCUTS, payload: !showShortcuts })}
                  aria-label="Show keyboard shortcuts"
                  title="Show keyboard shortcuts"
                  aria-expanded={showShortcuts}
                  aria-controls="shortcuts-panel"
                >
                  ⌨
                </button>
                <button
                  type="button"
                  className="shortcuts-help-btn"
                  onClick={() => {
                    setDeepLinkHash('');
                    setShowTxLookup(true);
                  }}
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
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: `var(--ws-${wsStatus})`,
                      display: 'inline-block',
                    }}
                    aria-hidden="true"
                  />
                  <span aria-hidden="true" className={wsStatus === 'failed' ? 'ws-status-failed' : ''}>
                    {wsStatus === 'failed' ? 'Connection lost' : wsStatus}
                  </span>
                </motion.span>
              </div>
            </div>

            <AnimatePresence>
              {updateAvailable && (
                <motion.div
                  className="pwa-banner pwa-banner--update"
                  role="status"
                  variants={v.fadeSlide}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <span>A new version is available.</span>
                  <button type="button" className="pwa-banner__btn" onClick={applyUpdate}>
                    Update now
                  </button>
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
                variants={v.pop}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <div className="shortcuts-panel__header">
                  <strong id="shortcuts-title">Keyboard Shortcuts</strong>
                  <button
                    type="button"
                    className="qr-close"
                    onClick={() => dispatch({ type: A.SET_SHOW_SHORTCUTS, payload: false })}
                    aria-label="Close keyboard shortcuts"
                  >
                    ✕
                  </button>
                </div>
                <ul className="shortcuts-list">
                  <li>
                    <kbd>Ctrl+N</kbd> Create new account
                  </li>
                  <li>
                    <kbd>Ctrl+B</kbd> Check balance
                  </li>
                  <li>
                    <kbd>Ctrl+C</kbd> Copy key (when copy button focused)
                  </li>
                  <li>
                    <kbd>Escape</kbd> Close modals
                  </li>
                  <li>
                    <kbd>?</kbd> Toggle this help
                  </li>
                  <li>
                    <kbd>Tab</kbd> Navigate between fields
                  </li>
                  <li>
                    <kbd>Enter</kbd> Submit focused form
                  </li>
                </ul>
              </motion.div>
            )}
          </AnimatePresence>

          <main id="main-content">
            {/* Create / Import Account */}
            <motion.section
              className="section"
              aria-labelledby="account-heading"
              variants={v.fadeSlide}
              initial="hidden"
              animate="visible"
            >
              <h2 id="account-heading" className="sr-only">
                Account
              </h2>
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
                  <motion.div
                    id="import-form"
                    variants={v.fadeSlide}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                  >
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
                      style={{
                        border: `2px solid ${recipientTouched ? (recipientValid ? '#22c55e' : '#ef4444') : '#ccc'}`,
                      }}
                      aria-label="Recipient public key"
                    />
                    {recipientTouched && (
                      <span className="input-icon">{recipientValid ? '✅' : '❌'}</span>
                    )}
                  </div>
                  <AnimatePresence>
                    {recipientTouched && !recipientValid && (
                      <motion.p
                        className="field-error"
                        variants={v.fadeSlide}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                      >
                        Invalid Stellar address format (must start with G and be 56 characters)
                      </motion.p>
                    )}
                  </AnimatePresence>
                  {/* Asset Selector */}
                  <div className="input-wrap">
                    <label htmlFor="asset-select" style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: 4, display: 'block' }}>Asset</label>
                    <select
                      id="asset-select"
                      value={assetCode}
                      onChange={(e) => handleAssetChange(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        border: '2px solid #ccc',
                        borderRadius: '4px',
                        fontSize: '1rem',
                      }}
                      aria-label="Select asset to send"
                    >
                      {balance?.balances && balance.balances.map((b) => (
                        <option key={b.asset} value={b.asset}>
                          {b.asset} - {formatBalanceWithAsset(b.balance, b.asset)}
                        </option>
                      ))}
                    </select>
                  </div>
                  {trustlineAsset && (
                    <InlineConfirmation
                      isVisible={!!trustlineAsset}
                      message={`You don't have a trustline for ${trustlineAsset}. Create one?`}
                      confirmText="Create Trustline"
                      cancelText="Cancel"
                      onConfirm={handleCreateTrustline}
                      onCancel={() => {
                        setTrustlineAsset(null);
                        dispatch({ type: A.SET_ASSET_CODE, payload: 'XLM' });
                      }}
                    />
                  )}
                  <div className="input-wrap">
                    <input
                      type="text"
                      placeholder={`Amount (${assetCode})`}
                      value={amount}
                      onChange={(e) =>
                        dispatch({ type: A.SET_AMOUNT, payload: formatAmount(e.target.value) })
                      }
                      onKeyDown={(e) => e.key === 'Enter' && setShowConfirm(true)}
                      style={{
                        border: `2px solid ${amountTouched ? (amountValid ? '#22c55e' : '#ef4444') : '#ccc'}`,
                      }}
                      aria-label={`Payment amount in ${assetCode}`}
                    />
                    {amountTouched && (
                      <span className="input-icon">{amountValid ? '✅' : '❌'}</span>
                    )}
                  </div>
                  <AnimatePresence>
                    {amountTouched && amountError && (
                      <motion.p
                        className="field-error"
                        variants={v.fadeSlide}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                      >
                        {amountError}
                      </motion.p>
                    )}
                  </AnimatePresence>
                  <FeeDisplay amount={amount} visible={amountValid} />
                  {amountValid &&
                    (xlmUsdRate ? (
                      <p className="rate-estimate" aria-live="polite">
                        ≈ ${(parseFloat(amount) * xlmUsdRate).toFixed(2)} USD
                        <span className="rate-source"> · live rate</span>
                      </p>
                    ) : (
                      rateLoading && (
                        <p className="rate-estimate rate-estimate--loading" aria-live="polite">
                          Loading rate…
                        </p>
                      )
                    ))}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <motion.button
                      onClick={batchMode ? addBatchRecipient : sendPayment}
                      {...tap}
                      disabled={!recipientValid || !amountValid || loading === 'send' || (batchMode && batchRecipients.length >= 10)}
                    >
                      {loading === 'send' ? (
                        <Spinner label={batchMode ? 'Adding...' : 'Sending payment...'} />
                      ) : batchMode ? (
                        'Add to Batch'
                      ) : (
                        'Send'
                      )}
                    </motion.button>
                    {batchMode && batchRecipients.length > 0 && (
                      <motion.button
                        onClick={() => {
                          setShowPaymentConfirmation(true);
                        }}
                        {...tap}
                        disabled={loading === 'send'}
                        style={{ background: '#10b981' }}
                      >
                        {loading === 'send' ? (
                          <Spinner label="Sending..." />
                        ) : (
                          `Send Batch (${batchRecipients.length})`
                        )}
                      </motion.button>
                    )}
                    {confirmClear ? (
                      <span className="confirm-clear" role="group" aria-label="Confirm clear form">
                        <span className="confirm-clear__label">Clear form?</span>
                        <button
                          type="button"
                          className="confirm-clear__yes"
                          onClick={confirmClearYes}
                          aria-label="Yes, clear the form"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          className="confirm-clear__no"
                          onClick={confirmClearNo}
                          aria-label="No, keep the form"
                        >
                          No
                        </button>
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
                  <motion.div
                    className="account-info"
                    variants={v.pop}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    aria-label="Account details"
                  >
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
                  <motion.section
                    className="section"
                    aria-labelledby="balance-heading"
                    variants={v.fadeSlide}
                  >
                    <h2 id="balance-heading" className="sr-only">
                      Balance
                    </h2>
                    <motion.button
                      onClick={checkBalance}
                      {...tap}
                      disabled={loading === 'balance'}
                      aria-busy={loading === 'balance'}
                      aria-label="Check account balance"
                    >
                      {loading === 'balance' ? 'Checking Balance…' : 'Check Balance'}
                    </motion.button>
                    <AnimatePresence mode="wait">
                      {loading === 'balance' ? (
                        <SkeletonBalance key="loading-balance" />
                      ) : balance ? (
                        <motion.div
                          key="balance-list"
                          variants={v.pop}
                          initial="hidden"
                          animate="visible"
                          exit="exit"
                          style={{ marginTop: 10 }}
                          aria-label="Account balances"
                          role="list"
                        >
                          {balance.balances.map((b, i) => (
                            <motion.p
                              key={i}
                              variants={v.fadeSlide}
                              className="balance-row"
                              role="listitem"
                            >
                              <span className="balance-asset">
                                {b.asset}
                                {b.asset === 'XLM' && <XLMInfoIcon />}
                              </span>
                              <span className="balance-amount">
                                {formatBalanceWithAsset(b.balance, b.asset)}
                              </span>
                            </motion.p>
                          ))}
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </motion.section>

                  {/* Send Payment */}
                  <motion.section
                    className="section"
                    aria-labelledby="send-heading"
                    variants={v.fadeSlide}
                  >
                    <ErrorBoundary context="send-payment">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <h2 id="send-heading">Send Payment</h2>
                        <button
                          type="button"
                          style={{
                            padding: '8px 12px',
                            background: batchMode ? '#2563eb' : '#ccc',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                          }}
                          onClick={() => setBatchMode(!batchMode)}
                        >
                          {batchMode ? 'Batch Mode (On)' : 'Batch Mode (Off)'}
                        </button>
                      </div>
                      
                      {batchMode && batchRecipients.length > 0 && (
                        <div style={{ padding: '12px', background: '#f0f9ff', border: '1px solid #bfdbfe', borderRadius: '4px', marginBottom: 16 }}>
                          <h3 style={{ margin: '0 0 8px 0', fontSize: '0.95rem', fontWeight: 600 }}>
                            Recipients ({batchRecipients.length}/10)
                          </h3>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {batchRecipients.map((p, i) => (
                              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', background: '#fff', borderRadius: '3px' }}>
                                <span style={{ fontSize: '0.85rem' }}>
                                  {formatBalanceWithAsset(p.amount, p.assetCode)} to {p.destination.slice(0, 16)}...
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeBatchRecipient(i)}
                                  style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: '2px', cursor: 'pointer', fontSize: '0.8rem' }}
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      <AddressBook
                        onSelect={(address) =>
                          dispatch({ type: A.SET_RECIPIENT, payload: address })
                        }
                        prefillAddress={recipient}
                      />
                      <div className="input-wrap">
                        <label htmlFor="recipient-input" className="sr-only">
                          Recipient public key
                        </label>
                        <input
                          id="recipient-input"
                          type="text"
                          placeholder="Recipient Public Key"
                          value={recipient}
                          onChange={(e) =>
                            dispatch({ type: A.SET_RECIPIENT, payload: e.target.value })
                          }
                          onKeyDown={(e) => e.key === 'Enter' && sendPayment()}
                          style={{
                            border: `2px solid ${recipientTouched ? (recipientValid ? '#22c55e' : '#ef4444') : '#ccc'}`,
                          }}
                          aria-invalid={recipientTouched && !recipientValid}
                          aria-describedby={
                            recipientTouched && !recipientValid ? 'recipient-error' : undefined
                          }
                          autoComplete="off"
                        />
                        {recipientTouched && (
                          <span className="input-icon" aria-hidden="true">
                            {recipientValid ? '✅' : '❌'}
                          </span>
                        )}
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
                            onScan={(parsed) => {
                              dispatch({ type: A.SET_RECIPIENT, payload: parsed.destination });
                              if (parsed.amount) dispatch({ type: A.SET_AMOUNT, payload: parsed.amount });
                              if (parsed.memo) dispatch({ type: A.SET_MEMO, payload: parsed.memo });
                              if (parsed.memoType) dispatch({ type: A.SET_MEMO_TYPE, payload: parsed.memoType });
                              setShowScanner(false);
                            }}
                            onClose={() => setShowScanner(false)}
                          />
                        )}
                      </AnimatePresence>
                      <AnimatePresence>
                        {recipientTouched && !recipientValid && (
                          <motion.p
                            id="recipient-error"
                            className="field-error"
                            role="alert"
                            variants={v.fadeSlide}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                          >
                            Invalid Stellar address format (must start with G and be 56 characters)
                          </motion.p>
                        )}
                      </AnimatePresence>

                      <div className="input-wrap">
                        <label htmlFor="amount-input" className="sr-only">
                          Payment amount in XLM
                        </label>
                        <input
                          id="amount-input"
                          type="text"
                          inputMode="decimal"
                          placeholder="Amount (XLM)"
                          value={amount}
                          onChange={(e) =>
                            dispatch({ type: A.SET_AMOUNT, payload: formatAmount(e.target.value) })
                          }
                          onKeyDown={(e) => e.key === 'Enter' && sendPayment()}
                          style={{
                            border: `2px solid ${amountTouched ? (amountValid ? '#22c55e' : '#ef4444') : '#ccc'}`,
                          }}
                          aria-invalid={amountTouched && !!amountError}
                          aria-describedby={
                            amountTouched && amountError ? 'amount-error' : undefined
                          }
                          autoComplete="transaction-amount"
                        />
                        {amountTouched && (
                          <span className="input-icon" aria-hidden="true">
                            {amountValid ? '✅' : '❌'}
                          </span>
                        )}
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
                      <div
                        style={{
                          fontSize: '13px',
                          color: 'var(--muted)',
                          marginTop: '-8px',
                          marginBottom: '8px',
                        }}
                      >
                        <XLMInfoIcon /> XLM is the native Stellar currency
                      </div>
                      <AnimatePresence>
                        {amountTouched && amountError && (
                          <motion.p
                            id="amount-error"
                            className="field-error"
                            role="alert"
                            variants={v.fadeSlide}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                          >
                            {amountError}
                          </motion.p>
                        )}
                      </AnimatePresence>

                      <div className="input-wrap memo-wrap">
                        <label htmlFor="memo-type-select" className="sr-only">
                          Memo type
                        </label>
                        <select
                          id="memo-type-select"
                          value={memoType}
                          onChange={(e) =>
                            dispatch({ type: A.SET_MEMO_TYPE, payload: e.target.value })
                          }
                          aria-label="Memo type"
                        >
                          <option value="text">Text</option>
                          <option value="id">ID (exchange)</option>
                          <option value="hash">Hash (32 bytes)</option>
                          <option value="return">Return (32 bytes)</option>
                        </select>
                        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                          <label htmlFor="memo-input" className="sr-only">
                            {memoType === 'text' && 'Payment memo (optional, max 28 bytes)'}
                            {memoType === 'id' && 'Numeric memo ID (uint64, exchange deposit)'}
                            {(memoType === 'hash' || memoType === 'return') && `${memoType} memo (64 hex chars = 32 bytes)`}
                          </label>
                          <input
                            id="memo-input"
                            type={memoType === 'id' ? 'number' : 'text'}
                            inputMode={memoType === 'id' ? 'numeric' : undefined}
                            placeholder={
                              memoType === 'text' ? 'Memo (optional, max 28 bytes)' :
                              memoType === 'id' ? 'Numeric memo ID (exchange deposit)' :
                              `${memoType} memo (64 hex characters)`
                            }
                            value={memo}
                            onChange={(e) => {
                              let val = e.target.value;
                              if (memoType === 'id') {
                                val = val.replace(/\D/g, '').slice(0, 20);
                              } else if (memoType === 'hash' || memoType === 'return') {
                                val = val.replace(/[^0-9a-fA-F]/g, '').slice(0, 64);
                              } else {
                                // text: limit by byte count (UTF-8), not char count
                                const encoder = new TextEncoder();
                                while (encoder.encode(val).length > 28) {
                                  val = val.slice(0, -1);
                                }
                              }
                              dispatch({ type: A.SET_MEMO, payload: val });
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && sendPayment()}
                            aria-label={
                              memoType === 'text' ? 'Payment memo (optional)' :
                              memoType === 'id' ? 'Numeric memo ID for exchange deposit' :
                              `${memoType} memo (64 hex characters)`
                            }
                            maxLength={memoType === 'id' ? 20 : memoType === 'text' ? undefined : 64}
                            style={{ paddingRight: memo ? '60px' : '10px' }}
                          />
                          {memo && (
                            <span className="input-icon" aria-hidden="true">
                              {memoType === 'text' && `${new TextEncoder().encode(memo).length}/28 bytes`}
                              {memoType === 'id' && memo.length > 0 && '✓'}
                              {(memoType === 'hash' || memoType === 'return') && `${memo.length}/64`}
                            </span>
                          )}
                        </div>
                      </div>

                      {memo && memoType === 'hash' && memo.length > 0 && memo.length !== 64 && (
                        <p className="field-error" role="alert">Hash memo must be exactly 64 hex characters (32 bytes)</p>
                      )}
                      {memo && memoType === 'return' && memo.length > 0 && memo.length !== 64 && (
                        <p className="field-error" role="alert">Return memo must be exactly 64 hex characters (32 bytes)</p>
                      )}
                      {memo && memoType === 'id' && memo && BigInt(memo) > 18446744073709551615n && (
                        <p className="field-error" role="alert">Memo ID exceeds max uint64 value</p>
                      )}

                      <FeeDisplay amount={amount} visible={amountValid} />
                      {amountValid &&
                        (xlmFiatRate ? (
                          <p className="rate-estimate" aria-live="polite">
                            ≈ {(parseFloat(amount) * xlmFiatRate).toFixed(2)} {fiatCurrency}
                            <span className="rate-source"> · live rate</span>
                          </p>
                        ) : (
                          rateLoading && (
                            <p className="rate-estimate rate-estimate--loading" aria-live="polite">
                              Loading rate…
                            </p>
                          )
                        ))}
                      <div className="payment-form-actions">
                        <motion.button
                          onClick={() => setShowConfirm(true)}
                          {...tap}
                          disabled={
                            !recipientValid ||
                            !amountValid ||
                            loading === 'send' ||
                            largeTransactionBlocked ||
                            ((memoType === 'hash' || memoType === 'return') && memo.length > 0 && memo.length !== 64)
                          }
                          aria-busy={loading === 'send'}
                          aria-label="Send XLM payment"
                        >
                          {loading === 'send' ? <Spinner label="Sending payment…" /> : 'Send'}
                        </motion.button>
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
                      {largeTransactionBlocked && (
                        <p className="kyc-warning">
                          Large transactions above {KYC_LARGE_TRANSACTION_LIMIT} XLM
                          <XLMInfoIcon /> require approved KYC.
                        </p>
                      )}
                    </ErrorBoundary>
                  </motion.section>

                  {/* File Upload */}
                  <motion.section className="section" variants={v.fadeSlide}>
                    <h2 className="sr-only">File Upload</h2>
                    <FileUpload />
                  </motion.section>

                  {/* Transaction History */}
                  <motion.div variants={v.fadeSlide}>
                    <ErrorBoundary context="Transaction History">
                      <TransactionHistory publicKey={account.publicKey} />
                    </ErrorBoundary>
                  </motion.div>

                  {/* Stream Payments */}
                  <motion.div variants={v.fadeSlide}>
                    <ErrorBoundary context="Stream Payments">
                      <StreamPayment publicKey={account.publicKey} />
                    </ErrorBoundary>
                  </motion.div>

                  {/* Asset Conversion Calculator */}
                  <motion.div variants={v.fadeSlide}>
                    <ConvertWidget />
                  </motion.div>

                  {/* AMM Pool Browser */}
                  <motion.div variants={v.fadeSlide}>
                    <Suspense fallback={<Spinner />}>
                      <AMMPoolBrowser />
                    </Suspense>
                  </motion.div>

                  {/* Account Recovery */}
                  <motion.div variants={v.fadeSlide}>
                    <Suspense fallback={<Spinner />}>
                      <AccountRecovery />
                    </Suspense>
                  </motion.div>
                  {/* Settings Sections Tabs */}
                  <motion.section className="section" variants={v.fadeSlide}>
                    <h2 style={{ marginBottom: 16 }}>Advanced Features</h2>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                      {[
                        { id: 'multisig', label: '🔐 Multi-Sig' },
                        { id: 'kyc', label: '📋 KYC' },
                        { id: 'notifications', label: '🔔 Notifications' },
                        {
                          id: 'backup',
                          label: '💾 Backup',
                          action: () => setShowBackupSettings(true),
                        },
                        ...(['COMPLIANCE', 'ADMIN'].includes(userRole)
                          ? [
                              {
                                id: 'compliance',
                                label: '🛡️ Compliance',
                                action: () => setShowComplianceDashboard(true),
                              },
                            ]
                          : []),
                      ].map((section) => (
                        <button
                          key={section.id}
                          type="button"
                          onClick={() => {
                            if (section.action) {
                              section.action();
                            } else {
                              setActiveSettingsSection(
                                activeSettingsSection === section.id ? null : section.id
                              );
                            }
                          }}
                          style={{
                            padding: '10px 16px',
                            background:
                              activeSettingsSection === section.id ? '#2563eb' : '#f3f4f6',
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
                        <motion.div
                          key="multisig"
                          variants={v.fadeSlide}
                          initial="hidden"
                          animate="visible"
                          exit="exit"
                        >
                          <Suspense fallback={<Spinner />}>
                            <MultiSigTransactions publicKey={account.publicKey} />
                          </Suspense>
                          <ErrorBoundary context="Multi-Sig Transactions">
                            <MultiSigTransactions publicKey={account.publicKey} />
                          </ErrorBoundary>
                        </motion.div>
                      )}
                      {activeSettingsSection === 'kyc' && (
                        <motion.div
                          key="kyc"
                          variants={v.fadeSlide}
                          initial="hidden"
                          animate="visible"
                          exit="exit"
                        >
                          <Suspense fallback={<Spinner />}>
                            <KYCForm />
                          </Suspense>
                          <ErrorBoundary context="KYC Form">
                            <KYCForm />
                          </ErrorBoundary>
                        </motion.div>
                      )}
                      {activeSettingsSection === 'notifications' && (
                        <motion.div
                          key="notifications"
                          variants={v.fadeSlide}
                          initial="hidden"
                          animate="visible"
                          exit="exit"
                        >
                          <NotificationPreferences />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.section>
                  {/* Path Payment */}
                  <motion.div variants={v.fadeSlide}>
                    <ErrorBoundary context="Path Payment">
                      <PathPayment account={account} />
                    </ErrorBoundary>
                  </motion.div>
                {/* Account Recovery */}
                <motion.div variants={v.fadeSlide}>
                  <Suspense fallback={<Spinner />}>
                    <AccountRecovery />
                  </Suspense>
                </motion.div>
                {/* Settings Sections Tabs */}
                <motion.section className="section" variants={v.fadeSlide}>
                  <h2 style={{ marginBottom: 16 }}>Advanced Features</h2>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                    {[
                      { id: 'multisig', label: '🔐 Multi-Sig', ariaLabel: 'Toggle multi-signature transactions panel' },
                      { id: 'kyc', label: '📋 KYC', ariaLabel: 'Toggle KYC identity verification panel' },
                      { id: 'notifications', label: '🔔 Notifications', ariaLabel: 'Toggle notification preferences panel' },
                      { id: 'backup', label: '💾 Backup', ariaLabel: 'Open backup settings', action: () => setShowBackupSettings(true) },
                      ...(['COMPLIANCE', 'ADMIN'].includes(userRole) ? [{ id: 'compliance', label: '🛡️ Compliance', ariaLabel: 'Open compliance dashboard', action: () => setShowComplianceDashboard(true) }] : []),
                    ].map((section) => (
                      <button
                        key={section.id}
                        type="button"
                        aria-label={section.ariaLabel}
                        aria-expanded={!section.action ? activeSettingsSection === section.id : undefined}
                        aria-controls={!section.action ? `advanced-section-${section.id}` : undefined}
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
                      <motion.div id="advanced-section-multisig" key="multisig" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
                        <Suspense fallback={<Spinner />}>
                          <MultiSigTransactions publicKey={account.publicKey} />
                        </Suspense>
                        <ErrorBoundary context="Multi-Sig Transactions">
                          <MultiSigTransactions publicKey={account.publicKey} />
                        </ErrorBoundary>
                      </motion.div>
                    )}
                    {activeSettingsSection === 'kyc' && (
                      <motion.div id="advanced-section-kyc" key="kyc" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
                        <Suspense fallback={<Spinner />}>
                          <KYCForm />
                        </Suspense>
                        <ErrorBoundary context="KYC Form">
                          <KYCForm />
                        </ErrorBoundary>
                      </motion.div>
                    )}
                    {activeSettingsSection === 'notifications' && (
                      <motion.div id="advanced-section-notifications" key="notifications" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
                        <NotificationPreferences />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.section>
                {/* Path Payment */}
                <motion.div variants={v.fadeSlide}>
                  <ErrorBoundary context="Path Payment">
                    <PathPayment account={account} />
                  </ErrorBoundary>
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
              <QRCodeModal
                publicKey={account.publicKey}
                onClose={() => dispatch({ type: A.SET_SHOW_QR, payload: false })}
              />
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
                variants={v.pop}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <div className="replay-modal">
                  <h2 id="replay-title">Send queued payments</h2>
                  <p>
                    You have {pendingCount} queued payment{pendingCount > 1 ? 's' : ''} waiting to
                    be sent. Enter your secret key to authorise {pendingCount > 1 ? 'them' : 'it'}.
                  </p>
                  <label htmlFor="replay-secret" className="sr-only">
                    Secret key
                  </label>
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
                    <button
                      type="button"
                      onClick={replayQueued}
                      disabled={!replaySecret}
                      aria-label="Send queued payments"
                    >
                      Send now
                    </button>
                    <button
                      type="button"
                      className="btn-clear"
                      onClick={() => {
                        setShowReplayPrompt(false);
                        setReplaySecret('');
                      }}
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
            onConfirm={() => {
              setShowConfirm(false);
              sendPayment();
            }}
            onCancel={() => setShowConfirm(false)}
          />

          {/* Batch Payment Confirmation */}
          <AnimatePresence>
            {showPaymentConfirmation && batchMode && batchRecipients.length > 0 && (
              <motion.div
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(0,0,0,0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1000,
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  style={{
                    background: '#fff',
                    borderRadius: '8px',
                    padding: '24px',
                    maxWidth: '500px',
                    maxHeight: '80vh',
                    overflow: 'auto',
                  }}
                  initial={{ scale: 0.9, y: 20 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.9, y: 20 }}
                >
                  <h3 style={{ marginTop: 0, marginBottom: 16 }}>Confirm Batch Payment</h3>
                  <div style={{ marginBottom: 16, padding: '12px', background: '#f3f4f6', borderRadius: '4px' }}>
                    <p style={{ margin: '0 0 12px 0', fontWeight: 600 }}>Recipients ({batchRecipients.length}/10):</p>
                    {batchRecipients.map((p, i) => (
                      <div key={i} style={{ fontSize: '0.875rem', marginBottom: 8, paddingBottom: 8, borderBottom: i < batchRecipients.length - 1 ? '1px solid #e5e7eb' : 'none' }}>
                        <p style={{ margin: '0 0 4px 0' }}>{p.destination.slice(0, 20)}...</p>
                        <p style={{ margin: 0, color: '#666' }}>{formatBalanceWithAsset(p.amount, p.assetCode)}</p>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                    <button
                      onClick={confirmBatchPayment}
                      disabled={loading === 'send'}
                      style={{
                        flex: 1,
                        padding: '12px',
                        background: '#10b981',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      {loading === 'send' ? 'Sending...' : 'Confirm & Send'}
                    </button>
                    <button
                      onClick={() => setShowPaymentConfirmation(false)}
                      disabled={loading === 'send'}
                      style={{
                        flex: 1,
                        padding: '12px',
                        background: '#e5e7eb',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showTxLookup && (
              <TxLookup
                initialHash={deepLinkHash}
                accountPublicKey={account?.publicKey ?? ''}
                onClose={() => {
                  setShowTxLookup(false);
                  setDeepLinkHash('');
                }}
              />
            )}
          </AnimatePresence>

          {/* Payment Confirmation Modal */}
          <AnimatePresence>
            {showPaymentConfirmation && (
              <PaymentConfirmationModal
                isOpen={showPaymentConfirmation}
                onClose={() => setShowPaymentConfirmation(false)}
                onConfirm={confirmPayment}
                recipient={recipient}
                amount={amount}
                estimatedFee="0.00001"
                loading={loading === 'send'}
              />
            )}
            {showSettings && account && (
              <AccountSettings
                publicKey={account.publicKey}
                onClose={() => setShowSettings(false)}
              />
            )}

        {showBackupSettings && (
          <Suspense fallback={<Spinner />}>
            <BackupSettings onClose={() => setShowBackupSettings(false)} />
          </Suspense>
        )}
      </AnimatePresence>
    </motion.div>
    </div>
  </>
            {showComplianceDashboard && (
              <ErrorBoundary context="Compliance Dashboard">
                <Suspense fallback={<Spinner />}>
                  <ComplianceDashboard onClose={() => setShowComplianceDashboard(false)} />
                </Suspense>
              </ErrorBoundary>
            )}

            {showBackupSettings && (
              <Suspense fallback={<Spinner />}>
                <BackupSettings onClose={() => setShowBackupSettings(false)} />
              </Suspense>
            )}

            {/* MFA Recovery Code Entry */}
            {showRecoveryCodeEntry && (
              <motion.div
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(0,0,0,0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 2000,
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  style={{
                    background: '#fff',
                    borderRadius: '8px',
                    padding: '24px',
                    maxWidth: '400px',
                  }}
                  initial={{ scale: 0.9, y: 20 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.9, y: 20 }}
                >
                  <h3 style={{ marginTop: 0, marginBottom: 8 }}>Enter Recovery Code</h3>
                  <p style={{ fontSize: '0.875rem', color: '#666', marginBottom: 16 }}>
                    Your TOTP device is unavailable. Enter one of your recovery codes to continue.
                  </p>
                  <input
                    type="text"
                    placeholder="Recovery Code (8 hex characters)"
                    value={recoveryCode}
                    onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
                    maxLength={8}
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '2px solid #ccc',
                      borderRadius: '4px',
                      fontSize: '1rem',
                      fontFamily: 'monospace',
                      boxSizing: 'border-box',
                      marginBottom: 16,
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={handleRecoveryCodeSubmit}
                      disabled={recoveryCode.length !== 8}
                      style={{
                        flex: 1,
                        padding: '12px',
                        background: '#2563eb',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      Submit
                    </button>
                    <button
                      onClick={() => {
                        setShowRecoveryCodeEntry(false);
                        setRecoveryCode('');
                      }}
                      style={{
                        flex: 1,
                        padding: '12px',
                        background: '#e5e7eb',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </>
  );
}

export default App;
