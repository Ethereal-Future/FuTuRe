import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function PaymentOperationForm({ onAdd, publicKey }) {
  const { t } = useTranslation();
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState('XLM');
  const [issuer, setIssuer] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!destination) {
      setError(t('paymentOperationForm.destinationRequired'));
      return;
    }

    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
      setError(t('paymentOperationForm.amountRequired'));
      return;
    }

    if (asset !== 'XLM' && !issuer) {
      setError(t('paymentOperationForm.issuerRequired'));
      return;
    }

    if (destination === publicKey) {
      setError(t('paymentOperationForm.selfSendError'));
      return;
    }

    onAdd({
      destination,
      amount: parseFloat(amount).toString(),
      asset: asset === 'XLM' ? { code: 'XLM' } : { code: asset, issuer },
      memo: memo || undefined,
    });

    setDestination('');
    setAmount('');
    setAsset('XLM');
    setIssuer('');
    setMemo('');
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <p role="alert" style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: 8 }}>
          {error}
        </p>
      )}
      <div style={{ marginBottom: 8 }}>
        <label htmlFor="payment-destination" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
          {t('paymentOperationForm.destinationLabel')}
        </label>
        <input
          id="payment-destination"
          type="text"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="G..."
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: 8 }}>
        <label htmlFor="payment-amount" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
          {t('paymentOperationForm.amountLabel')}
        </label>
        <input
          id="payment-amount"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.0"
          step="0.0000001"
          min="0"
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label htmlFor="payment-asset" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
            {t('paymentOperationForm.assetLabel')}
          </label>
          <select
            id="payment-asset"
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="XLM">XLM</option>
            <option value="USDC">USDC</option>
            <option value="EURC">EURC</option>
            <option value="other">{t('paymentOperationForm.other')}</option>
          </select>
        </div>

        {asset !== 'XLM' && (
          <div>
            <label htmlFor="payment-issuer" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
              {t('paymentOperationForm.issuerLabel')}
            </label>
            <input
              id="payment-issuer"
              type="text"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder="G..."
              style={{ width: '100%' }}
            />
          </div>
        )}
      </div>

      <div style={{ marginBottom: 8 }}>
        <label htmlFor="payment-memo" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
          {t('paymentOperationForm.memoLabel')}
        </label>
        <input
          id="payment-memo"
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder={t('paymentOperationForm.memoPlaceholder')}
          style={{ width: '100%' }}
        />
      </div>

      <button type="submit" style={{ width: '100%', marginTop: 8 }}>
        {t('paymentOperationForm.submit')}
      </button>
    </form>
  );
}
