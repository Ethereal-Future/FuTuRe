import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { isValidStellarAddress } from '../utils/validateStellarAddress';
import { validateAmount, formatAmount } from '../utils/validateAmount';
import { getFriendlyError } from '../utils/errorMessages';
import { useAppState, useAppDispatch, A } from '../store/index.js';
import { useMessages } from '../hooks/useMessages';
import { makeVariants, tapScale } from '../utils/animations';
import { useReducedMotion } from 'framer-motion';
import { QRScanner } from '../components/QRScanner';
import { ConfirmSendDialog } from '../components/ConfirmSendDialog';
import { PaymentConfirmationModal } from '../components/PaymentConfirmationModal';
import { LargeTransactionWarning } from '../components/LargeTransactionWarning';
import { logError } from '../utils/errorLogger';

const TIMEOUT_MS = 30000;
const KYC_LARGE_TRANSACTION_LIMIT = 1000;

function withTimeout(promiseFn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return promiseFn(controller.signal).finally(() => clearTimeout(timer));
}

export function SendPaymentPage() {
  const { account, balance, loading, recipient, amount, memo, memoType } = useAppState();
  const dispatch = useAppDispatch();
  const msg = useMessages();

  const [showConfirm, setShowConfirm] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showPaymentConfirmation, setShowPaymentConfirmation] = useState(false);
  const [kycStatus, setKycStatus] = useState(null);

  const prefersReduced = useReducedMotion();
  const v = makeVariants(prefersReduced);
  const tap = tapScale(prefersReduced);

  const xlmBalance = balance?.balances?.find(b => b.asset === 'XLM')?.balance ?? null;
  const amountTouched = amount.length > 0;
  const amountError = validateAmount(amount, xlmBalance !== null ? parseFloat(xlmBalance) : null);
  const amountValid = amountTouched && !amountError;
  const recipientValid = recipient.length === 56 && isValidStellarAddress(recipient);
  const recipientTouched = recipient.length > 0;
  const largeTransactionBlocked = amountValid && kycStatus !== 'APPROVED' && parseFloat(amount) > KYC_LARGE_TRANSACTION_LIMIT;

  const handleSendMax = () => {
    if (xlmBalance === null) return;
    const maxSendable = Math.max(0, parseFloat(xlmBalance) - 1 - 0.00001);
    dispatch({ type: A.SET_AMOUNT, payload: maxSendable.toFixed(7).replace(/\.?0+$/, '') });
  };

  const sendPayment = async () => {
    if (!account || !recipientValid || !amountValid) return;
    if (largeTransactionBlocked) {
      msg.error('Large transactions require KYC approval');
      return;
    }

    dispatch({ type: A.SET_LOADING, payload: 'send' });
    try {
      const { data } = await withTimeout(signal =>
        axios.post('/api/stellar/payment/send', {
          sourceSecret: account.secretKey,
          destination: recipient,
          amount,
          assetCode: 'XLM',
          memo: memo || undefined,
          memoType: memoType || undefined,
        }, { signal })
      );

      msg.success(`Payment sent! Hash: ${data.hash?.slice(0, 8)}…`);
      dispatch({ type: A.RESET_FORM });
      setShowPaymentConfirmation(false);
    } catch (error) {
      logError(error, { context: 'sendPayment' });
      msg.error(getFriendlyError(error));
    } finally {
      dispatch({ type: A.SET_LOADING, payload: '' });
    }
  };

  const confirmPayment = () => {
    setShowPaymentConfirmation(false);
    sendPayment();
  };

  return (
    <motion.section className="section" variants={v.fadeSlide}>
      <h2>Send Payment</h2>

      <div style={{ marginBottom: 16 }}>
        <label htmlFor="recipient">Recipient Address</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="recipient"
            type="text"
            placeholder="G…"
            value={recipient}
            onChange={(e) => dispatch({ type: A.SET_RECIPIENT, payload: e.target.value })}
            style={{
              flex: 1,
              padding: '8px 12px',
              border: recipientTouched && !recipientValid ? '2px solid #dc2626' : '1px solid #d1d5db',
              borderRadius: 4,
            }}
          />
          <button
            type="button"
            onClick={() => setShowScanner(!showScanner)}
            style={{ padding: '8px 16px', background: '#0066cc', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            📱 Scan
          </button>
        </div>
        {recipientTouched && !recipientValid && <p style={{ color: '#dc2626', fontSize: 12, marginTop: 4 }}>Invalid address</p>}
      </div>

      {showScanner && <QRScanner onScan={(data) => { dispatch({ type: A.SET_RECIPIENT, payload: data }); setShowScanner(false); }} />}

      <div style={{ marginBottom: 16 }}>
        <label htmlFor="amount">Amount (XLM)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="amount"
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => dispatch({ type: A.SET_AMOUNT, payload: e.target.value })}
            style={{
              flex: 1,
              padding: '8px 12px',
              border: amountTouched && !amountValid ? '2px solid #dc2626' : '1px solid #d1d5db',
              borderRadius: 4,
            }}
          />
          <button
            type="button"
            onClick={handleSendMax}
            style={{ padding: '8px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            Max
          </button>
        </div>
        {amountTouched && amountError && <p style={{ color: '#dc2626', fontSize: 12, marginTop: 4 }}>{amountError}</p>}
      </div>

      {largeTransactionBlocked && <LargeTransactionWarning amount={amount} />}

      <button
        type="button"
        onClick={() => setShowPaymentConfirmation(true)}
        disabled={!recipientValid || !amountValid || loading === 'send' || largeTransactionBlocked}
        style={{
          padding: '10px 20px',
          background: recipientValid && amountValid && !largeTransactionBlocked ? '#0066cc' : '#d1d5db',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: recipientValid && amountValid && !largeTransactionBlocked ? 'pointer' : 'not-allowed',
          fontWeight: 500,
        }}
      >
        {loading === 'send' ? 'Sending…' : 'Send Payment'}
      </button>

      <PaymentConfirmationModal
        isOpen={showPaymentConfirmation}
        onClose={() => setShowPaymentConfirmation(false)}
        onConfirm={confirmPayment}
        recipient={recipient}
        amount={amount}
        estimatedFee="0.00001"
        loading={loading === 'send'}
      />

      <ConfirmSendDialog
        open={showConfirm}
        recipient={recipient}
        amount={amount}
        asset="XLM"
        onConfirm={() => { setShowConfirm(false); sendPayment(); }}
        onCancel={() => setShowConfirm(false)}
      />
    </motion.section>
  );
}
