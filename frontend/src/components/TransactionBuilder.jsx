import { useState, useEffect } from 'react';
import apiClient from '../api/client.js';
import { formatAssetAmount } from '../utils/formatAmount';
import { PaymentOperationForm } from './operations/PaymentOperationForm';
import { ChangeTrustOperationForm } from './operations/ChangeTrustOperationForm';
import { ManageDataOperationForm } from './operations/ManageDataOperationForm';
import { SetOptionsOperationForm } from './operations/SetOptionsOperationForm';
import { ManageOfferOperationForm } from './operations/ManageOfferOperationForm';

const MAX_OPERATIONS = 100;

export function TransactionBuilder({ publicKey, onClose, onSuccess }) {
  const [operations, setOperations] = useState([]);
  const [operationType, setOperationType] = useState('payment');
  const [feeStats, setFeeStats] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showAtomicityWarning, setShowAtomicityWarning] = useState(
    !localStorage.getItem('seenAtomicityWarning')
  );

  useEffect(() => {
    apiClient
      .get('/api/stellar/fee-stats')
      .then(({ data }) => setFeeStats(data))
      .catch((e) => setError(e?.response?.data?.error ?? e.message));
  }, []);

  const handleAddOperation = (operationData) => {
    if (operations.length >= MAX_OPERATIONS) {
      setError(`Maximum ${MAX_OPERATIONS} operations per transaction reached`);
      return;
    }

    const newOperation = {
      id: Date.now(),
      type: operationType,
      data: operationData,
    };

    setOperations([...operations, newOperation]);
    setOperationType('payment');
  };

  const handleRemoveOperation = (id) => {
    setOperations(operations.filter((op) => op.id !== id));
  };

  const handleReorderOperation = (fromIndex, toIndex) => {
    const newOps = [...operations];
    const [moved] = newOps.splice(fromIndex, 1);
    newOps.splice(toIndex, 0, moved);
    setOperations(newOps);
  };

  const calculateTotalFee = () => {
    if (!feeStats) return '0';
    const baseFee = parseInt(feeStats.base_fee || '100');
    const totalFee = baseFee * (operations.length || 1);
    return formatAssetAmount(totalFee / 1e7);
  };

  const submitTransaction = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        sourceSecret: localStorage.getItem('secretKey'),
        operations: operations.map((op) => ({
          type: op.type,
          ...op.data,
        })),
      };

      const response = await apiClient.post('/api/stellar/transaction/multi-op/build', payload);
      const { transactionHash } = response.data;

      localStorage.setItem('seenAtomicityWarning', 'true');
      setShowConfirmation(false);
      onSuccess?.(transactionHash);
      onClose?.();
    } catch (e) {
      setError(e?.response?.data?.error ?? e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="replay-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tx-builder-title"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="replay-modal" style={{ maxWidth: 600, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <h2 id="tx-builder-title" style={{ margin: 0 }}>
            Advanced Transaction Builder
          </h2>
          <button type="button" className="qr-close" onClick={onClose} aria-label="Close builder">
            ✕
          </button>
        </div>

        {showAtomicityWarning && (
          <div
            style={{
              background: '#fef3c7',
              border: '1px solid #fcd34d',
              borderRadius: 6,
              padding: 12,
              marginBottom: 16,
            }}
            role="alert"
          >
            <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: '0.9rem' }}>
              ⚡ Multi-operation atomicity
            </p>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#78350f' }}>
              All operations in this transaction will either succeed or fail together. If any operation fails, the
              entire transaction is rolled back and you will be charged the base fee.
            </p>
            <button
              type="button"
              onClick={() => setShowAtomicityWarning(false)}
              style={{ marginTop: 8, fontSize: '0.8rem' }}
            >
              I understand
            </button>
          </div>
        )}

        {error && (
          <p role="alert" style={{ color: '#ef4444', marginBottom: 12 }}>
            {error}
          </p>
        )}

        <div style={{ marginBottom: 16, padding: 12, background: '#f8fafc', borderRadius: 6 }}>
          <label
            htmlFor="operation-type-select"
            style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: '0.9rem' }}
          >
            Add Operation
          </label>
          <select
            id="operation-type-select"
            value={operationType}
            onChange={(e) => setOperationType(e.target.value)}
            style={{ marginBottom: 8 }}
          >
            <option value="payment">Payment</option>
            <option value="changeTrust">Add/Modify Trustline</option>
            <option value="manageData">Manage Data</option>
            <option value="setOptions">Set Options</option>
            <option value="manageSellOffer">Manage Sell Offer</option>
            <option value="manageBuyOffer">Manage Buy Offer</option>
          </select>

          {operationType === 'payment' && (
            <PaymentOperationForm onAdd={handleAddOperation} publicKey={publicKey} />
          )}
          {operationType === 'changeTrust' && (
            <ChangeTrustOperationForm onAdd={handleAddOperation} publicKey={publicKey} />
          )}
          {operationType === 'manageData' && (
            <ManageDataOperationForm onAdd={handleAddOperation} />
          )}
          {operationType === 'setOptions' && (
            <SetOptionsOperationForm onAdd={handleAddOperation} publicKey={publicKey} />
          )}
          {(operationType === 'manageSellOffer' || operationType === 'manageBuyOffer') && (
            <ManageOfferOperationForm onAdd={handleAddOperation} type={operationType} />
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <h3 style={{ margin: 0, fontSize: '1rem' }}>
              Operations ({operations.length}/{MAX_OPERATIONS})
            </h3>
            <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
              Total fee: {calculateTotalFee()} XLM
            </span>
          </div>

          {operations.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: '0.9rem', margin: 0 }}>
              No operations added yet. Add an operation to get started.
            </p>
          ) : (
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {operations.map((op, index) => (
                <li
                  key={op.id}
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 6,
                    padding: 12,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>
                      {index + 1}. {op.type.charAt(0).toUpperCase() + op.type.slice(1).replace(/([A-Z])/g, ' $1')}
                    </p>
                    <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                      {JSON.stringify(op.data).substring(0, 60)}...
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {index > 0 && (
                      <button
                        type="button"
                        onClick={() => handleReorderOperation(index, index - 1)}
                        style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                        aria-label="Move up"
                      >
                        ↑
                      </button>
                    )}
                    {index < operations.length - 1 && (
                      <button
                        type="button"
                        onClick={() => handleReorderOperation(index, index + 1)}
                        style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                        aria-label="Move down"
                      >
                        ↓
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveOperation(op.id)}
                      style={{ padding: '4px 8px', fontSize: '0.8rem', background: '#ef4444', color: '#fff' }}
                      aria-label="Remove operation"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {operations.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setShowConfirmation(true)}
              disabled={submitting}
              style={{ flex: 1, background: '#22c55e' }}
            >
              {submitting ? 'Submitting…' : 'Review & Submit'}
            </button>
            <button type="button" className="btn-clear" onClick={onClose}>
              Cancel
            </button>
          </div>
        )}

        {showConfirmation && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
            onClick={() => setShowConfirmation(false)}
          >
            <div
              style={{
                background: '#fff',
                borderRadius: 8,
                padding: 24,
                maxWidth: 500,
                width: '90%',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ margin: '0 0 16px' }}>Confirm Transaction</h3>
              <div style={{ maxHeight: 300, overflow: 'auto', marginBottom: 16 }}>
                {operations.map((op, index) => (
                  <div
                    key={op.id}
                    style={{
                      background: '#f8fafc',
                      padding: 12,
                      marginBottom: 8,
                      borderRadius: 4,
                      fontSize: '0.9rem',
                    }}
                  >
                    <p style={{ margin: '0 0 8px', fontWeight: 600 }}>
                      {index + 1}. {op.type}
                    </p>
                    <pre
                      style={{
                        margin: 0,
                        fontSize: '0.8rem',
                        color: '#64748b',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {JSON.stringify(op.data, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
              <div
                style={{
                  background: '#f8fafc',
                  padding: 12,
                  borderRadius: 4,
                  marginBottom: 16,
                  fontSize: '0.9rem',
                }}
              >
                <p style={{ margin: 0 }}>
                  <strong>Total Fee:</strong> {calculateTotalFee()} XLM
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={submitTransaction}
                  disabled={submitting}
                  style={{ flex: 1, background: '#22c55e' }}
                >
                  {submitting ? 'Submitting…' : 'Submit'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowConfirmation(false)}
                  className="btn-clear"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
