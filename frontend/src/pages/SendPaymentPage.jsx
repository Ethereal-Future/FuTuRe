import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import apiClient from '../api/client.js';
import { isValidStellarAddress } from '../utils/validateStellarAddress';
import { validateAmount, formatAmount } from '../utils/validateAmount';
import { getFriendlyError } from '../utils/errorMessages';
import { useAppState, useAppDispatch, A } from '../store/index.js';
import { useMessages } from '../hooks/useMessages';
import { makeVariants, tapScale } from '../utils/animations';
import { useReducedMotion } from 'framer-motion';
import { QRScanner } from '../components/QRScanner';
import { AmountInput } from '../components/AmountInput';
import { PaymentConfirmationModal } from '../components/PaymentConfirmationModal';
import { LargeTransactionWarning } from '../components/LargeTransactionWarning';
import { Sep7UriHandler } from '../components/Sep7UriHandler';
import { logError } from '../utils/errorLogger';

const KYC_LARGE_TRANSACTION_LIMIT = 1000;

export function SendPaymentPage() {
  const { t } = useTranslation();
  const { account, balance, loading, recipient, amount, memo, memoType } = useAppState();
  const dispatch = useAppDispatch();
  const msg = useMessages();

  const [showScanner, setShowScanner] = useState(false);
  const [showPaymentConfirmation, setShowPaymentConfirmation] = useState(false);
  const [kycStatus, setKycStatus] = useState(null);
  const [sep7Uri, setSep7Uri] = useState(null);
  const [showSep7Handler, setShowSep7Handler] = useState(false);

  const prefersReduced = useReducedMotion();
  const v = makeVariants(prefersReduced);
  const tap = tapScale(prefersReduced);

  // Handle SEP-0007 URI from protocol handler or URL params
  useEffect(() => {
    const handleSep7Uri = async () => {
      // Check for URI in URL query params (for direct navigation)
      const params = new URLSearchParams(window.location.search);
      const uriParam = params.get('uri');

      if (uriParam) {
        setSep7Uri(uriParam);
        setShowSep7Handler(true);
        return;
      }

      // Check for shared data from protocol handler
      if (window.navigator.canShare && navigator.share) {
        // Note: This is handled by checking launchQueue if available
        // For PWA protocol handling, the URI comes through query params
      }
    };

    handleSep7Uri();

    // Listen for protocol handler events (in case app is already loaded)
    const handleProtocolUri = (e) => {
      if (e.data?.type === 'SEP7_URI') {
        setSep7Uri(e.data.uri);
        setShowSep7Handler(true);
      }
    };

    window.addEventListener('message', handleProtocolUri);
    return () => window.removeEventListener('message', handleProtocolUri);
  }, []);

  const xlmBalance = balance?.balances?.find(b => b.asset === 'XLM')?.balance ?? null;
  const amountTouched = amount.length > 0;
  const amountError = validateAmount(amount, xlmBalance !== null ? parseFloat(xlmBalance) : null);
  const amountValid = amountTouched && !amountError;
  const recipientValid = recipient.length === 56 && isValidStellarAddress(recipient);
  const recipientTouched = recipient.length > 0;
  const largeTransactionBlocked = amountValid && kycStatus !== 'APPROVED' && parseFloat(amount) > KYC_LARGE_TRANSACTION_LIMIT;

  // Reserve buffer (1 XLM minimum reserve + base fee) kept out of the sendable max.
  const maxSendable = xlmBalance !== null
    ? Math.max(0, parseFloat(xlmBalance) - 1 - 0.00001).toFixed(7).replace(/\.?0+$/, '')
    : null;

  const sendPayment = async () => {
    if (!account || !recipientValid || !amountValid) return;
    if (largeTransactionBlocked) {
      msg.error(t('sendPayment.kycRequired'));
      return;
    }

    dispatch({ type: A.SET_LOADING, payload: 'send' });
    try {
      const { data } = await apiClient.post('/api/stellar/payment/send', {
        sourceSecret: account.secretKey,
        destination: recipient,
        amount,
        assetCode: 'XLM',
        memo: memo || undefined,
        memoType: memoType || undefined,
      });

      msg.success(t('sendPayment.sentSuccess', { hash: data.hash?.slice(0, 8) }));
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

  const handleSep7Load = (parsed) => {
    setShowSep7Handler(false);
    // Pre-populate the form with SEP-0007 data
    dispatch({ type: A.SET_RECIPIENT, payload: parsed.destination });
    if (parsed.amount) {
      dispatch({ type: A.SET_AMOUNT, payload: parsed.amount });
    }
    if (parsed.memo) {
      dispatch({ type: A.SET_MEMO, payload: parsed.memo });
      if (parsed.memoType) {
        dispatch({ type: A.SET_MEMO_TYPE, payload: parsed.memoType });
      }
    }
    msg.info(t('sendPayment.sep7Prefilled'));
  };

  const handleSep7Error = (error) => {
    setShowSep7Handler(false);
    msg.error(t('sendPayment.sep7InvalidLink', { error }));
  };

  return (
    <motion.section className="section" variants={v.fadeSlide}>
      <h2>{t('sendPayment.title')}</h2>

      <div style={{ marginBottom: 16 }}>
        <label htmlFor="recipient">{t('sendPayment.recipientLabel')}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="recipient"
            type="text"
            placeholder={t('sendPayment.recipientPlaceholder')}
            value={recipient}
            onChange={(e) => dispatch({ type: A.SET_RECIPIENT, payload: e.target.value })}
            style={{
              flex: 1,
              padding: '8px 12px',
              border: recipientTouched && !recipientValid ? '2px solid #dc2626' : '1px solid #d1d5db',
              borderRadius: 4,
            }}
            aria-invalid={recipientTouched && !recipientValid}
            aria-describedby={recipientTouched && !recipientValid ? 'recipient-error' : undefined}
          />
          <button
            type="button"
            onClick={() => setShowScanner(!showScanner)}
            style={{ padding: '8px 16px', background: '#0066cc', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            {t('sendPayment.scanButton')}
          </button>
        </div>
        {recipientTouched && !recipientValid && (
          <p id="recipient-error" role="alert" style={{ color: '#dc2626', fontSize: 12, marginTop: 4 }}>
            {t('sendPayment.invalidAddress')}
          </p>
        )}
      </div>

      {showScanner && <QRScanner onScan={(data) => { dispatch({ type: A.SET_RECIPIENT, payload: data }); setShowScanner(false); }} />}

      <div style={{ marginBottom: 16 }}>
        <label id="amount-label">{t('sendPayment.amountLabel')}</label>
        <AmountInput
          value={amount}
          onChange={(value) => dispatch({ type: A.SET_AMOUNT, payload: value })}
          currency="XLM"
          availableBalance={maxSendable}
        />
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
        {loading === 'send' ? t('sendPayment.sending') : t('sendPayment.sendButton')}
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

      {showSep7Handler && (
        <Sep7UriHandler
          uri={sep7Uri}
          onLoad={handleSep7Load}
          onError={handleSep7Error}
          onClose={() => setShowSep7Handler(false)}
        />
      )}
    </motion.section>
  );
}
