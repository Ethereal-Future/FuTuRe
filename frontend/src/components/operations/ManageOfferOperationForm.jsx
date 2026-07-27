import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function ManageOfferOperationForm({ onAdd, type }) {
  const { t } = useTranslation();
  const [sellingCode, setSellingCode] = useState('XLM');
  const [sellingIssuer, setSellingIssuer] = useState('');
  const [buyingCode, setBuyingCode] = useState('USDC');
  const [buyingIssuer, setBuyingIssuer] = useState('');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState('');
  const [offerId, setOfferId] = useState('');
  const [error, setError] = useState('');

  const isSellOffer = type === 'manageSellOffer';
  const operationLabel = isSellOffer ? t('manageOfferForm.sell') : t('manageOfferForm.buy');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (offerId && offerId !== '0') {
      // Deleting or updating an offer
      if (!offerId || isNaN(offerId)) {
        setError(t('manageOfferForm.validOfferIdRequired'));
        return;
      }

      onAdd({
        selling: sellingCode === 'XLM' ? { code: 'XLM' } : { code: sellingCode, issuer: sellingIssuer },
        buying: buyingCode === 'XLM' ? { code: 'XLM' } : { code: buyingCode, issuer: buyingIssuer },
        amount: '0',
        price: '1',
        offerId,
      });
    } else {
      // Creating a new offer
      if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
        setError(t('manageOfferForm.validAmountRequired'));
        return;
      }

      if (!price || isNaN(price) || parseFloat(price) <= 0) {
        setError(t('manageOfferForm.validPriceRequired'));
        return;
      }

      if (sellingCode !== 'XLM' && !sellingIssuer) {
        setError(t('manageOfferForm.sellingIssuerRequired'));
        return;
      }

      if (buyingCode !== 'XLM' && !buyingIssuer) {
        setError(t('manageOfferForm.buyingIssuerRequired'));
        return;
      }

      onAdd({
        selling: sellingCode === 'XLM' ? { code: 'XLM' } : { code: sellingCode, issuer: sellingIssuer },
        buying: buyingCode === 'XLM' ? { code: 'XLM' } : { code: buyingCode, issuer: buyingIssuer },
        amount: parseFloat(amount).toString(),
        price: parseFloat(price).toString(),
      });
    }

    setSellingCode('XLM');
    setSellingIssuer('');
    setBuyingCode('USDC');
    setBuyingIssuer('');
    setAmount('');
    setPrice('');
    setOfferId('');
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <p role="alert" style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: 8 }}>
          {error}
        </p>
      )}

      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          id="delete-offer"
          type="checkbox"
          checked={offerId !== ''}
          onChange={(e) => setOfferId(e.target.checked ? '0' : '')}
          style={{ width: 'auto', minHeight: 'unset' }}
        />
        <label htmlFor="delete-offer" style={{ fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}>
          {t('manageOfferForm.deleteUpdateExisting')}
        </label>
      </div>

      {offerId !== '' && (
        <div style={{ marginBottom: 8 }}>
          <label htmlFor="offer-id" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
            {t('manageOfferForm.offerIdLabel')}
          </label>
          <input
            id="offer-id"
            type="number"
            value={offerId}
            onChange={(e) => setOfferId(e.target.value)}
            placeholder="0"
            min="0"
            style={{ width: '100%' }}
          />
        </div>
      )}

      {offerId === '' && (
        <>
          <div style={{ marginBottom: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label htmlFor="selling-code" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
                {t('manageOfferForm.sellingAssetLabel')}
              </label>
              <select
                id="selling-code"
                value={sellingCode}
                onChange={(e) => setSellingCode(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="XLM">XLM</option>
                <option value="USDC">USDC</option>
                <option value="EURC">EURC</option>
                <option value="other">{t('manageOfferForm.other')}</option>
              </select>
            </div>

            {sellingCode !== 'XLM' && (
              <div>
                <label htmlFor="selling-issuer" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
                  {t('manageOfferForm.sellingIssuerLabel')}
                </label>
                <input
                  id="selling-issuer"
                  type="text"
                  value={sellingIssuer}
                  onChange={(e) => setSellingIssuer(e.target.value)}
                  placeholder="G..."
                  style={{ width: '100%' }}
                />
              </div>
            )}
          </div>

          <div style={{ marginBottom: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label htmlFor="buying-code" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
                {t('manageOfferForm.buyingAssetLabel')}
              </label>
              <select
                id="buying-code"
                value={buyingCode}
                onChange={(e) => setBuyingCode(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="XLM">XLM</option>
                <option value="USDC">USDC</option>
                <option value="EURC">EURC</option>
                <option value="other">{t('manageOfferForm.other')}</option>
              </select>
            </div>

            {buyingCode !== 'XLM' && (
              <div>
                <label htmlFor="buying-issuer" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
                  {t('manageOfferForm.buyingIssuerLabel')}
                </label>
                <input
                  id="buying-issuer"
                  type="text"
                  value={buyingIssuer}
                  onChange={(e) => setBuyingIssuer(e.target.value)}
                  placeholder="G..."
                  style={{ width: '100%' }}
                />
              </div>
            )}
          </div>

          <div style={{ marginBottom: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label htmlFor="amount" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
                {t('manageOfferForm.amountLabel', { operation: operationLabel })}
              </label>
              <input
                id="amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                step="0.0000001"
                min="0"
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label htmlFor="price" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
                {t('manageOfferForm.priceLabel')}
              </label>
              <input
                id="price"
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.0"
                step="0.0000001"
                min="0"
                style={{ width: '100%' }}
              />
            </div>
          </div>
        </>
      )}

      <button type="submit" style={{ width: '100%', marginTop: 8 }}>
        {t('manageOfferForm.submit', { operation: operationLabel })}
      </button>
    </form>
  );
}
