import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { isValidStellarAddress } from './utils/validateStellarAddress';
import { validateAmount, formatAmount } from './utils/validateAmount';
import { getFriendlyError } from './utils/errorMessages';
import { useWebSocket } from './hooks/useWebSocket';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { useMessages } from './hooks/useMessages';
import { makeVariants, tapScale } from './utils/animations';
import { ErrorBoundary } from './components/ErrorBoundary';
import { QRCodeModal } from './components/QRCodeModal';
import { NetworkBadge } from './components/NetworkBadge';
import { StatusMessage } from './components/StatusMessage';
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
  const [lastUpdated, setLastUpdated] = useState(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [isTabVisible, setIsTabVisible] = useState(true);
  
  const intervalRef = useRef(null);

  const msg = useMessages();

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

  const checkBalance = async (isAutoRefresh = false) => {
    if (!account) return;
    if (isAutoRefresh && loading === 'balance') return; // Don't auto-refresh if manual refresh is loading
    
    if (!isAutoRefresh) setLoading('balance');
    try {
      const { data } = await axios.get(`/api/stellar/account/${account.publicKey}`);
      setBalance(data);
      setLastUpdated(new Date());
    } catch (error) {
      logError(error, { context: 'checkBalance', isAutoRefresh });
      if (!isAutoRefresh) {
        msg.error(getFriendlyError(error), { retry: () => checkBalance(false) });
      }
      // Don't show error for auto-refresh failures to avoid spam
    } finally {
      if (!isAutoRefresh) setLoading('');
    }
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
    try {
      const { data } = await axios.post('/api/stellar/payment/send', {
        sourceSecret: account.secretKey,
        destination: recipient,
        amount,
        assetCode: 'XLM'
      });
      msg.success(`Payment sent! Hash: ${data.hash}`);
      checkBalance();
    } catch (error) {
      logError(error, { context: 'sendPayment' });
      msg.error(getFriendlyError(error), { retry: sendPayment });
    } finally { setLoading(''); }
  };

  // Auto-refresh effect
  useEffect(() => {
    if (account && autoRefreshEnabled && isTabVisible) {
      // Initial balance check when account is created
      checkBalance(true);
      
      // Set up periodic refresh every 30 seconds
      intervalRef.current = setInterval(() => {
        checkBalance(true);
      }, 30000);
    } else {
      // Clear interval when conditions are not met
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [account, autoRefreshEnabled, isTabVisible]);

  // Tab visibility detection
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsTabVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Load user preference for auto-refresh
  useEffect(() => {
    const savedPreference = localStorage.getItem('autoRefreshEnabled');
    if (savedPreference !== null) {
      setAutoRefreshEnabled(JSON.parse(savedPreference));
    }
  }, []);

  // Save user preference for auto-refresh
  const toggleAutoRefresh = () => {
    const newValue = !autoRefreshEnabled;
    setAutoRefreshEnabled(newValue);
    localStorage.setItem('autoRefreshEnabled', JSON.stringify(newValue));
  };

  const formatLastUpdated = () => {
    if (!lastUpdated) return 'Never';
    const now = new Date();
    const diff = Math.floor((now - lastUpdated) / 1000);
    
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return lastUpdated.toLocaleDateString();
  };

  return (
    <div className="app">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Stellar Remittance Platform</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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

      {/* Create Account */}
      <motion.div className="section" variants={v.fadeSlide} initial="hidden" animate="visible">
        <motion.button onClick={createAccount} {...tap} disabled={loading === 'create'}>
          Create Account {loading === 'create' && <Spinner />}
        </motion.button>
        <AnimatePresence>
          {account && (
            <motion.div
              className="account-info"
              variants={v.pop}
              initial="hidden" animate="visible" exit="exit"
            >
              <p><strong>Public Key:</strong> {account.publicKey}</p>
              <p><strong>Secret Key:</strong> {account.secretKey}</p>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h3 style={{ margin: 0 }}>Balance</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.8rem', color: '#666' }}>
                    Last updated: {formatLastUpdated()}
                  </span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem' }}>
                    <input
                      type="checkbox"
                      checked={autoRefreshEnabled}
                      onChange={toggleAutoRefresh}
                      style={{ margin: 0 }}
                    />
                    Auto-refresh
                  </label>
                </div>
              </div>
              
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <motion.button 
                  onClick={() => checkBalance(false)} 
                  {...tap} 
                  disabled={loading === 'balance'}
                  style={{ flex: 1 }}
                >
                  🔄 Refresh {loading === 'balance' && <Spinner />}
                </motion.button>
              </div>
              
              <AnimatePresence>
                {balance && (
                  <motion.div variants={v.pop} initial="hidden" animate="visible" exit="exit">
                    {balance.balances.map((b, i) => (
                      <motion.p key={i} variants={v.fadeSlide} style={{ margin: '4px 0' }}>
                        <strong>{b.asset}:</strong> {b.balance}
                      </motion.p>
                    ))}
                    {autoRefreshEnabled && isTabVisible && (
                      <motion.p 
                        variants={v.fadeSlide} 
                        style={{ fontSize: '0.8rem', color: '#666', marginTop: 8 }}
                      >
                        🔄 Auto-refreshing every 30 seconds
                      </motion.p>
                    )}
                    {!isTabVisible && autoRefreshEnabled && (
                      <motion.p 
                        variants={v.fadeSlide} 
                        style={{ fontSize: '0.8rem', color: '#f59e0b', marginTop: 8 }}
                      >
                        ⏸️ Auto-refresh paused (tab not visible)
                      </motion.p>
                    )}
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
                  style={{ border: `2px solid ${recipientTouched ? (recipientValid ? '#22c55e' : '#ef4444') : '#ccc'}` }}
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
                  style={{ border: `2px solid ${amountTouched ? (amountValid ? '#22c55e' : '#ef4444') : '#ccc'}` }}
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
