import { useState } from 'react';
import axios from 'axios';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { isValidStellarAddress } from './utils/validateStellarAddress';
import { validateAmount, formatAmount } from './utils/validateAmount';
import { getFriendlyError } from './utils/errorMessages';
import { useWebSocket } from './hooks/useWebSocket';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { makeVariants, tapScale } from './utils/animations';
import { ErrorBoundary } from './components/ErrorBoundary';
import { QRCodeModal } from './components/QRCodeModal';
import { NetworkBadge } from './components/NetworkBadge';
import { logError } from './utils/errorLogger';

const STATUS_COLORS = { connected: '#22c55e', disconnected: '#ef4444', reconnecting: '#f59e0b' };

// Spinner for loading state
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
  const [status, setStatus] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState('');
  const [showQR, setShowQR] = useState(false);

  const prefersReduced = useReducedMotion();
  const v = makeVariants(prefersReduced);
  const tap = tapScale(prefersReduced);

  const setError = (error, retry) => setStatus({ type: 'error', message: getFriendlyError(error), retry });
  const setSuccess = (message) => setStatus({ type: 'success', message });

  const addNotification = (msg) => {
    const note = {
      id: Date.now(),
      text: msg.direction === 'received'
        ? `📥 Received ${msg.amount} ${msg.assetCode} — tx: ${msg.hash?.slice(0, 8)}…`
        : `📤 Sent ${msg.amount} ${msg.assetCode} — tx: ${msg.hash?.slice(0, 8)}…`
    };
    setNotifications((prev) => [note, ...prev].slice(0, 5));
  };

  const handleWsMessage = (msg) => {
    if (msg.type === 'transaction') {
      addNotification(msg);
      if (msg.balance) setBalance((prev) => prev ? { ...prev, balances: msg.balance } : null);
    }
  };

  const wsStatus = useWebSocket(account?.publicKey ?? null, handleWsMessage);
  const { status: networkStatus } = useNetworkStatus();

  const createAccount = async () => {
    setLoading('create');
    try {
      const { data } = await axios.post('/api/stellar/account/create');
      setAccount(data);
      setSuccess('Account created! Save your secret key securely.');
    } catch (error) {
      logError(error, { context: 'createAccount' });
      setError(error, createAccount);
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
      setError(error, checkBalance);
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
    try {
      const { data } = await axios.post('/api/stellar/payment/send', {
        sourceSecret: account.secretKey,
        destination: recipient,
        amount,
        assetCode: 'XLM'
      });
      setSuccess(`Payment sent! Hash: ${data.hash}`);
      checkBalance();
    } catch (error) {
      logError(error, { context: 'sendPayment' });
      setError(error, sendPayment);
    } finally { setLoading(''); }
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
              <motion.button onClick={checkBalance} {...tap} disabled={loading === 'balance'}>
                Check Balance {loading === 'balance' && <Spinner />}
              </motion.button>
              <AnimatePresence>
                {balance && (
                  <motion.div variants={v.pop} initial="hidden" animate="visible" exit="exit" style={{ marginTop: 10 }}>
                    {balance.balances.map((b, i) => (
                      <motion.p key={i} variants={v.fadeSlide}>{b.asset}: {b.balance}</motion.p>
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

            {/* Live Notifications */}
            <AnimatePresence>
              {notifications.length > 0 && (
                <motion.div className="section" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
                  <h3>Live Notifications</h3>
                  <AnimatePresence initial={false}>
                    {notifications.map((n) => (
                      <motion.div
                        key={n.id}
                        className="status-banner success"
                        variants={v.pop}
                        initial="hidden" animate="visible" exit="exit"
                        style={{ marginBottom: 6 }}
                        drag="x"
                        dragConstraints={{ left: 0, right: 0 }}
                        onDragEnd={(_, info) => {
                          if (Math.abs(info.offset.x) > 80)
                            setNotifications((prev) => prev.filter((x) => x.id !== n.id));
                        }}
                      >
                        <span>{n.text}</span>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>

          </motion.div>
        )}
      </AnimatePresence>

      {/* Status Banner */}
      <AnimatePresence>
        {status && (
          <motion.div
            className={`status-banner ${status.type}`}
            variants={v.pop}
            initial="hidden" animate="visible" exit="exit"
          >
            <span>{status.type === 'error' ? '⚠️' : '✅'}</span>
            <span className="msg">{status.message}</span>
            {status.retry && <motion.button onClick={status.retry} {...tap}>Retry</motion.button>}
          </motion.div>
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
