import { useState, useEffect } from 'react';
import apiClient from '../api/client.js';
import { AmountInput } from './AmountInput.jsx';
import { StatusMessage } from './StatusMessage.jsx';
import { formatAssetAmount } from '../utils/formatAmount';

/**
 * Component for depositing into and withdrawing from Stellar liquidity pools
 */
export function LiquidityPoolDepositWithdraw({ accountId, onSuccess }) {
  const [pools, setPools] = useState([]);
  const [selectedPool, setSelectedPool] = useState(null);
  const [mode, setMode] = useState('deposit'); // 'deposit' or 'withdraw'
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [shares, setShares] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [slippageTolerance, setSlippageTolerance] = useState('1');
  const [feeEstimate, setFeeEstimate] = useState(null);
  const [poolRatioWarn, setPoolRatioWarn] = useState(false);

  const fetchPools = async () => {
    try {
      const { data } = await apiClient.get('/api/stellar/amm/pools');
      setPools(data.pools ?? []);
    } catch (err) {
      setError('Failed to fetch pools');
    }
  };

  useEffect(() => {
    fetchPools();
  }, [accountId]);

  const calculateDepositAmounts = (amount, isAmountA) => {
    if (!selectedPool || !amount) return;

    const ratio = selectedPool.reserveB / selectedPool.reserveA;
    if (isAmountA) {
      const calculatedB = (parseFloat(amount) * ratio).toFixed(7);
      setAmountA(amount);
      setAmountB(calculatedB);
    } else {
      const calculatedA = (parseFloat(amount) / ratio).toFixed(7);
      setAmountB(amount);
      setAmountA(calculatedA);
    }
  };

  const estimateDepositFees = async () => {
    if (!selectedPool || !amountA || !amountB) return;

    try {
      const { data } = await apiClient.post('/api/stellar/amm/deposit/estimate', {
        poolId: selectedPool.poolId,
        amountA: parseFloat(amountA),
        amountB: parseFloat(amountB),
        slippageTolerance: parseFloat(slippageTolerance) / 100,
      });
      setFeeEstimate(data);
      setPoolRatioWarn(data.ratioShiftPct > 2);
    } catch (err) {
      setError('Failed to estimate fees');
    }
  };

  const estimateWithdrawFees = async () => {
    if (!selectedPool || !shares) return;

    try {
      const { data } = await apiClient.post('/api/stellar/amm/withdraw/estimate', {
        poolId: selectedPool.poolId,
        shares: parseFloat(shares),
        slippageTolerance: parseFloat(slippageTolerance) / 100,
      });
      setFeeEstimate(data);
      setPoolRatioWarn(data.ratioShiftPct > 2);
    } catch (err) {
      setError('Failed to estimate fees');
    }
  };

  const handleDeposit = async (e) => {
    e.preventDefault();
    if (!selectedPool || !amountA || !amountB) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const { data } = await apiClient.post('/api/stellar/amm/deposit', {
        sourceSecret: '', // In production, this would come from the secure context
        poolId: selectedPool.poolId,
        amountA: parseFloat(amountA),
        amountB: parseFloat(amountB),
        slippageTolerance: parseFloat(slippageTolerance) / 100,
      });

      setSuccess(`Deposit successful! Received ${data.sharesReceived} LP tokens`);
      setAmountA('');
      setAmountB('');
      setFeeEstimate(null);
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.normalized?.message || 'Deposit failed');
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async (e) => {
    e.preventDefault();
    if (!selectedPool || !shares) {
      setError('Please enter number of shares');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const { data } = await apiClient.post('/api/stellar/amm/withdraw', {
        sourceSecret: '', // In production, this would come from the secure context
        poolId: selectedPool.poolId,
        shares: parseFloat(shares),
        slippageTolerance: parseFloat(slippageTolerance) / 100,
      });

      setSuccess(
        `Withdrawal successful! Received ${data.amountA} ${selectedPool.assetA} and ${data.amountB} ${selectedPool.assetB}`
      );
      setShares('');
      setFeeEstimate(null);
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.normalized?.message || 'Withdrawal failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="section" aria-labelledby="pool-heading">
      <h2 id="pool-heading">Liquidity Pool Operations</h2>

      {error && (
        <StatusMessage
          messages={[{ id: 'pool-error', type: 'error', message: error, icon: '⚠️' }]}
          onRemove={() => setError('')}
        />
      )}
      {success && (
        <StatusMessage
          messages={[{ id: 'pool-success', type: 'success', message: success, icon: '✅' }]}
          onRemove={() => setSuccess('')}
        />
      )}

      <div style={{ marginBottom: 20 }}>
        <label htmlFor="mode-select">Operation:</label>
        <select
          id="mode-select"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            setError('');
            setSuccess('');
            setFeeEstimate(null);
          }}
          style={{ marginLeft: 10, padding: 8 }}
        >
          <option value="deposit">Deposit</option>
          <option value="withdraw">Withdraw</option>
        </select>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label htmlFor="pool-select">Pool:</label>
        <select
          id="pool-select"
          value={selectedPool?.poolId ?? ''}
          onChange={(e) => {
            const pool = pools.find((p) => p.poolId === e.target.value);
            setSelectedPool(pool);
            setFeeEstimate(null);
            setAmountA('');
            setAmountB('');
            setShares('');
          }}
          style={{ marginLeft: 10, padding: 8 }}
        >
          <option value="">-- Select Pool --</option>
          {pools.map((pool) => (
            <option key={pool.poolId} value={pool.poolId}>
              {pool.assetA} / {pool.assetB} (Fee: {pool.feeBps} bps)
            </option>
          ))}
        </select>
      </div>

      {selectedPool && (
        <>
          <div
            style={{
              padding: 12,
              backgroundColor: '#f3f4f6',
              borderRadius: 6,
              marginBottom: 20,
              fontSize: '0.9rem',
            }}
          >
            <p>
              <strong>Pool Details:</strong>
            </p>
            <p>Reserve A: {formatAssetAmount(selectedPool.reserveA, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</p>
            <p>Reserve B: {formatAssetAmount(selectedPool.reserveB, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</p>
            <p>Price: {formatAssetAmount(selectedPool.midPrice, { minimumFractionDigits: 6, maximumFractionDigits: 6 })} {selectedPool.assetB}/{selectedPool.assetA}</p>
          </div>

          {mode === 'deposit' ? (
            <form onSubmit={handleDeposit}>
              <div style={{ marginBottom: 15 }}>
                <label htmlFor="amount-a">Amount {selectedPool.assetA}:</label>
                <AmountInput
                  id="amount-a"
                  value={amountA}
                  onChange={(val) => calculateDepositAmounts(val, true)}
                  placeholder="0.00"
                  disabled={loading}
                />
              </div>

              <div style={{ marginBottom: 15 }}>
                <label htmlFor="amount-b">Amount {selectedPool.assetB} (auto-calculated):</label>
                <input
                  id="amount-b"
                  type="number"
                  value={amountB}
                  onChange={(e) => calculateDepositAmounts(e.target.value, false)}
                  placeholder="0.00"
                  step="0.0000001"
                  disabled={loading}
                  style={{ width: '100%', padding: 8, marginTop: 4 }}
                />
              </div>

              <div style={{ marginBottom: 15 }}>
                <label htmlFor="slippage-deposit">Slippage Tolerance (%):</label>
                <input
                  id="slippage-deposit"
                  type="number"
                  value={slippageTolerance}
                  onChange={(e) => setSlippageTolerance(e.target.value)}
                  placeholder="1"
                  step="0.1"
                  min="0"
                  max="50"
                  disabled={loading}
                  style={{ width: '100%', padding: 8, marginTop: 4 }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginBottom: 15 }}>
                <button
                  type="button"
                  onClick={estimateDepositFees}
                  disabled={loading || !amountA || !amountB}
                  style={{ flex: 1 }}
                >
                  Estimate Fees
                </button>
                <button type="submit" disabled={loading || !amountA || !amountB} style={{ flex: 1 }}>
                  {loading ? 'Depositing...' : 'Deposit'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleWithdraw}>
              <div style={{ marginBottom: 15 }}>
                <label htmlFor="shares-input">LP Shares to Redeem:</label>
                <AmountInput
                  id="shares-input"
                  value={shares}
                  onChange={setShares}
                  placeholder="0.00"
                  disabled={loading}
                />
              </div>

              <div style={{ marginBottom: 15 }}>
                <label htmlFor="slippage-withdraw">Slippage Tolerance (%):</label>
                <input
                  id="slippage-withdraw"
                  type="number"
                  value={slippageTolerance}
                  onChange={(e) => setSlippageTolerance(e.target.value)}
                  placeholder="1"
                  step="0.1"
                  min="0"
                  max="50"
                  disabled={loading}
                  style={{ width: '100%', padding: 8, marginTop: 4 }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginBottom: 15 }}>
                <button
                  type="button"
                  onClick={estimateWithdrawFees}
                  disabled={loading || !shares}
                  style={{ flex: 1 }}
                >
                  Estimate Fees
                </button>
                <button type="submit" disabled={loading || !shares} style={{ flex: 1 }}>
                  {loading ? 'Withdrawing...' : 'Withdraw'}
                </button>
              </div>
            </form>
          )}

          {feeEstimate && (
            <div
              style={{
                padding: 12,
                backgroundColor: '#dbeafe',
                borderRadius: 6,
                marginTop: 15,
                fontSize: '0.9rem',
              }}
            >
              <p>
                <strong>Fee Estimate:</strong>
              </p>
              <p>Base Fee: {feeEstimate.baseFee} XLM</p>
              <p>Network Fee: {feeEstimate.networkFee} XLM</p>
              {mode === 'deposit' && <p>LP Shares: {feeEstimate.sharesReceived}</p>}
              {mode === 'withdraw' && (
                <>
                  <p>Amount A: {feeEstimate.amountA}</p>
                  <p>Amount B: {feeEstimate.amountB}</p>
                </>
              )}
              {poolRatioWarn && (
                <p style={{ color: '#ea580c', marginTop: 8 }}>
                  ⚠️ Pool ratio has shifted significantly since form load
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
