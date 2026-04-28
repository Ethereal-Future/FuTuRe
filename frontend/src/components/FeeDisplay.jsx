import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

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
    axios.get('/api/stellar/fee-stats')
      .then(({ data }) => { cache.current = data; setFee(data); })
      .catch(() => {});
  }, [visible]);

  if (!visible || !fee) return null;

  const amtNum = parseFloat(amount) || 0;
  const feeXLM = parseFloat(fee.feeXLM);
  const total = (amtNum + feeXLM).toFixed(7).replace(/\.?0+$/, '');
  const xlmUsd = fee.xlmUsd ? parseFloat(fee.xlmUsd) : null;
  const totalUsd = xlmUsd ? ((amtNum + feeXLM) * xlmUsd).toFixed(2) : null;
  const savingsUsd = fee.feeUsd
    ? (fee.traditionalFeeUsd - parseFloat(fee.feeUsd)).toFixed(2)
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
          {fee.feeXLM} XLM
          {fee.feeUsd && <span className="fee-usd"> ≈ ${fee.feeUsd}</span>}
        </span>
      </div>

      {amtNum > 0 && (
        <div className="fee-row fee-total">
          <span className="fee-label">Total (amount + fee)</span>
          <span className="fee-val">
            {total} XLM
            {totalUsd && <span className="fee-usd"> ≈ ${totalUsd}</span>}
          </span>
        </div>
      )}

      {savingsUsd && (
        <div className="fee-row fee-saving">
          <span>💸 Save ~${savingsUsd} vs. traditional wire (avg ${fee.traditionalFeeUsd})</span>
        </div>
      )}
    </div>
  );
}
