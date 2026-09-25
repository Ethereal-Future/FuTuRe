import { useState, useEffect } from 'react';
import apiClient from '../api/client.js';
import { AmountInput } from './AmountInput.jsx';
import { StatusMessage } from './StatusMessage.jsx';
import { formatAssetAmount } from '../utils/formatAmount';

/**
 * Component for creating, viewing, modifying, and canceling DEX offers
 */
export function DEXOfferManagement({ accountId, onSuccess }) {
  const [offers, setOffers] = useState([]);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [mode, setMode] = useState('view'); // 'view', 'create', 'modify', 'cancel'
  const [selectedOffer, setSelectedOffer] = useState(null);

  // Form state for creating/modifying offers
  const [sellingAsset, setSellingAsset] = useState('XLM');
  const [buyingAsset, setBuyingAsset] = useState('USD');
  const [sellingAmount, setSellingAmount] = useState('');
  const [price, setPrice] = useState('');
  const [offerId, setOfferId] = useState('0');
  const [submitting, setSubmitting] = useState(false);

  const fetchOffers = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await apiClient.get(`/api/stellar/offers/${accountId}`);
      setOffers(data.offers || []);
    } catch (err) {
      setError('Failed to fetch offers');
    } finally {
      setLoading(false);
    }
  };

  const fetchAssets = async () => {
    try {
      const { data } = await apiClient.get('/api/stellar/trustline/assets');
      setAssets(data.assets || []);
    } catch (err) {
      setError('Failed to fetch assets');
    }
  };

  useEffect(() => {
    if (accountId) {
      fetchOffers();
      fetchAssets();
    }
  }, [accountId]);

  const calculateBuyAmount = (amount, priceVal) => {
    if (!amount || !priceVal) return '';
    return (parseFloat(amount) * parseFloat(priceVal)).toFixed(7);
  };

  const handleCreateOffer = async (e) => {
    e.preventDefault();
    if (!sellingAmount || !price) {
      setError('Please fill in all required fields');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const { data } = await apiClient.post('/api/stellar/offers/create', {
        sourceSecret: '', // In production, from secure context
        sellingAsset,
        buyingAsset,
        sellingAmount: parseFloat(sellingAmount),
        price: parseFloat(price),
      });

      setSuccess(
        `Offer created successfully! Offer ID: ${data.offerId}`
      );
      setSellingAmount('');
      setPrice('');
      setMode('view');
      await fetchOffers();
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.normalized?.message || 'Failed to create offer');
    } finally {
      setSubmitting(false);
    }
  };

  const handleModifyOffer = async (e) => {
    e.preventDefault();
    if (!sellingAmount || !price || !offerId) {
      setError('Please fill in all required fields');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const { data } = await apiClient.post('/api/stellar/offers/modify', {
        sourceSecret: '', // In production, from secure context
        offerId,
        sellingAsset,
        buyingAsset,
        sellingAmount: parseFloat(sellingAmount),
        price: parseFloat(price),
      });

      setSuccess('Offer modified successfully!');
      setSellingAmount('');
      setPrice('');
      setOfferId('0');
      setMode('view');
      await fetchOffers();
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.normalized?.message || 'Failed to modify offer');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelOffer = async (offer) => {
    if (!window.confirm(`Cancel offer ${offer.id}?`)) return;

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      await apiClient.post('/api/stellar/offers/cancel', {
        sourceSecret: '', // In production, from secure context
        offerId: offer.id,
      });

      setSuccess('Offer canceled successfully!');
      setMode('view');
      await fetchOffers();
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.normalized?.message || 'Failed to cancel offer');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditOffer = (offer) => {
    setSelectedOffer(offer);
    setMode('modify');
    setOfferId(offer.id.toString());
    setSellingAsset(offer.selling.asset_code || 'XLM');
    setBuyingAsset(offer.buying.asset_code || 'XLM');
    setSellingAmount(offer.amount);
    setPrice((parseFloat(offer.price_r.n) / parseFloat(offer.price_r.d)).toFixed(7));
  };

  const buyAmount = calculateBuyAmount(sellingAmount, price);

  if (loading) {
    return <div>Loading DEX offers...</div>;
  }

  return (
    <section className="section" aria-labelledby="offers-heading">
      <h2 id="offers-heading">DEX Offers Management</h2>

      {error && (
        <StatusMessage
          messages={[{ id: 'offers-error', type: 'error', message: error, icon: '⚠️' }]}
          onRemove={() => setError('')}
        />
      )}
      {success && (
        <StatusMessage
          messages={[{ id: 'offers-success', type: 'success', message: success, icon: '✅' }]}
          onRemove={() => setSuccess('')}
        />
      )}

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={() => {
              setMode('view');
              setError('');
              setSuccess('');
            }}
            style={{
              padding: '8px 16px',
              backgroundColor: mode === 'view' ? '#3b82f6' : '#f3f4f6',
              color: mode === 'view' ? '#fff' : '#000',
              cursor: 'pointer',
              borderRadius: 4,
            }}
          >
            View Offers
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('create');
              setSellingAmount('');
              setPrice('');
              setSellingAsset('XLM');
              setBuyingAsset('USD');
              setError('');
              setSuccess('');
            }}
            style={{
              padding: '8px 16px',
              backgroundColor: mode === 'create' ? '#3b82f6' : '#f3f4f6',
              color: mode === 'create' ? '#fff' : '#000',
              cursor: 'pointer',
              borderRadius: 4,
            }}
          >
            Create Offer
          </button>
        </div>
      </div>

      {mode === 'view' ? (
        <>
          {offers.length === 0 ? (
            <p style={{ color: '#888' }}>No open offers yet.</p>
          ) : (
            <div
              role="list"
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              }}
            >
              {offers.map((offer) => (
                <div
                  key={offer.id}
                  role="listitem"
                  style={{
                    padding: 12,
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <h3 style={{ margin: '0 0 8px 0', fontSize: '0.95rem' }}>
                        {offer.selling.asset_code || 'XLM'} / {offer.buying.asset_code || 'XLM'}
                      </h3>
                      <p style={{ margin: '4px 0', fontSize: '0.9rem', color: '#666' }}>
                        Offer ID: <strong>{offer.id}</strong>
                      </p>
                    </div>
                    <div style={{ fontSize: '0.85rem', textAlign: 'right' }}>
                      <p style={{ margin: '0 0 4px 0', color: '#10b981' }}>
                        Sell: <strong>{offer.amount}</strong>
                      </p>
                      <p style={{ margin: '0 0 4px 0', color: '#3b82f6' }}>
                        Price: <strong>{formatAssetAmount(parseFloat(offer.price_r.n) / parseFloat(offer.price_r.d))}</strong>
                      </p>
                    </div>
                  </div>

                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e5e7eb' }}>
                    <p style={{ margin: 0, fontSize: '0.85rem' }}>
                      Est. Receive: {formatAssetAmount(parseFloat(offer.amount) * (parseFloat(offer.price_r.n) / parseFloat(offer.price_r.d)))}
                    </p>
                    <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#666' }}>
                      Created: {new Date(offer.created_at).toLocaleDateString()}
                    </p>
                  </div>

                  <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => handleEditOffer(offer)}
                      disabled={submitting}
                      style={{ flex: 1, padding: 6, fontSize: '0.85rem' }}
                    >
                      Modify
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancelOffer(offer)}
                      disabled={submitting}
                      style={{
                        flex: 1,
                        padding: 6,
                        fontSize: '0.85rem',
                        backgroundColor: '#fee2e2',
                        color: '#dc2626',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : mode === 'create' || mode === 'modify' ? (
        <form onSubmit={mode === 'create' ? handleCreateOffer : handleModifyOffer}>
          <div style={{ marginBottom: 15 }}>
            <label htmlFor="selling-asset">Selling Asset:</label>
            <select
              id="selling-asset"
              value={sellingAsset}
              onChange={(e) => setSellingAsset(e.target.value)}
              disabled={submitting}
              style={{ marginLeft: 10, padding: 8 }}
            >
              {assets.map((asset) => (
                <option key={asset.code} value={asset.code}>
                  {asset.code}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 15 }}>
            <label htmlFor="buying-asset">Buying Asset:</label>
            <select
              id="buying-asset"
              value={buyingAsset}
              onChange={(e) => setBuyingAsset(e.target.value)}
              disabled={submitting}
              style={{ marginLeft: 10, padding: 8 }}
            >
              {assets.map((asset) => (
                <option key={asset.code} value={asset.code}>
                  {asset.code}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 15 }}>
            <label htmlFor="selling-amount">Amount to Sell:</label>
            <AmountInput
              id="selling-amount"
              value={sellingAmount}
              onChange={setSellingAmount}
              placeholder="0.00"
              disabled={submitting}
            />
          </div>

          <div style={{ marginBottom: 15 }}>
            <label htmlFor="price-input">Price ({buyingAsset}/{sellingAsset}):</label>
            <input
              id="price-input"
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              step="0.0000001"
              min="0"
              disabled={submitting}
              style={{ width: '100%', padding: 8, marginTop: 4 }}
            />
          </div>

          {buyAmount && (
            <div
              style={{
                padding: 10,
                backgroundColor: '#dbeafe',
                borderRadius: 4,
                marginBottom: 15,
                fontSize: '0.9rem',
              }}
            >
              Expected to receive: <strong>{buyAmount} {buyingAsset}</strong>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="submit" disabled={submitting} style={{ flex: 1 }}>
              {submitting ? 'Processing...' : mode === 'create' ? 'Create Offer' : 'Modify Offer'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('view');
                setSellingAmount('');
                setPrice('');
              }}
              disabled={submitting}
              style={{
                flex: 1,
                backgroundColor: '#f3f4f6',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
