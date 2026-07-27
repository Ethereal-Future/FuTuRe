import { useState, useEffect, useRef } from 'react';
import apiClient from '../api/client.js';
import { formatAmount, formatAssetAmount } from '../utils/formatAmount';

const TOOLTIP = `Stellar charges a small network fee per transaction (base fee × operations). `
  + `The fee is burned and not collected by any party. `
  + `It protects the network from spam.`;

export function FeeDisplay({ amount, visible }) {
  const [fee, setFee] = useState(null);
  const [showTip, setShowTip] = useState(false);
  const cache = useRef(null);

  useEffect(() => {
    if (!visible) return;
    if (cache.current) { setFee(cache.current); return; }
    apiClient.get('/api/stellar/fee-stats')
      .then(({ data }) => { cache.current = data; setFee(data); })
      .catch(() => {});
  }, [visible]);

  if (!visible || !fee) return null;

  const amtNum = parseFloat(amount) || 0;
  const feeXLM = parseFloat(fee.feeXLM);
  const total = formatAssetAmount(amtNum + feeXLM);
  const xlmUsd = fee.xlmUsd ? parseFloat(fee.xlmUsd) : null;
  const totalUsd = xlmUsd ? formatAmount((amtNum + feeXLM) * xlmUsd, 'USD') : null;
  const savingsUsd = fee.feeUsd
    ? formatAmount(fee.traditionalFeeUsd - parseFloat(fee.feeUsd), 'USD')
    : null;

  return (
    <div className="fee-box">
      <div className="fee-row fee-header">
        <span>Network Fee</span>
        <button
          className="fee-tip-btn"
          onClick={() => setShowTip(s => !s)}
          aria-label="Fee explanation"
          type="button"
        >ⓘ</button>
      </div>

      {showTip && <p className="fee-tooltip">{TOOLTIP}</p>}

      <div className="fee-row">
        <span className="fee-label">Fee</span>
        <span className="fee-val">
          {formatAssetAmount(fee.feeXLM)} XLM
          {fee.feeUsd && <span className="fee-usd"> ≈ {formatAmount(fee.feeUsd, 'USD')}</span>}
        </span>
      </div>

      {amtNum > 0 && (
        <div className="fee-row fee-total">
          <span className="fee-label">Total (amount + fee)</span>
          <span className="fee-val">
            {total} XLM
            {totalUsd && <span className="fee-usd"> ≈ {totalUsd}</span>}
          </span>
        </div>
      )}

      {savingsUsd && (
        <div className="fee-row fee-saving">
          <span>💸 Save ~{savingsUsd} vs. traditional wire (avg {formatAmount(fee.traditionalFeeUsd, 'USD')})</span>
        </div>
      )}
    </div>
  );
}
