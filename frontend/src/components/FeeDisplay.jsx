import { useState, useEffect, useRef } from 'react';
import apiClient from '../api/client.js';
import { formatAmount, formatAssetAmount } from '../utils/formatAmount';
import { toStroops, xlmToStroops, formatStroopsAsXlm, STROOPS_PER_XLM } from '../utils/stroops';

const TOOLTIP = `Stellar charges a small network fee per transaction (base fee × operations). `
  + `The fee is burned and not collected by any party. `
  + `It protects the network from spam.`;

export function FeeDisplay({ amount, visible, assetCode }) {
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
  const isNativeAsset = !assetCode || assetCode === 'XLM';

  // #1701: keep fee math in BigInt stroops so surge spikes beyond
  // Number.MAX_SAFE_INTEGER never overflow or render as NaN.
  const feeStroops = toStroops(fee.feeStroopsExact) ?? toStroops(fee.feeStroops) ?? xlmToStroops(fee.feeXLM);
  if (feeStroops === null) return null;
  const amountStroops = xlmToStroops(amount) ?? 0n;
  const feeText = formatStroopsAsXlm(feeStroops);

  // Only add amounts together if both are in XLM
  const totalStroops = isNativeAsset ? amountStroops + feeStroops : null;
  const total = totalStroops !== null ? formatStroopsAsXlm(totalStroops) : null;

  // USD values are display-only approximations; guard against non-finite.
  const toXlmNumber = (st) => Number(st / STROOPS_PER_XLM) + Number(st % STROOPS_PER_XLM) / 1e7;
  const finiteUsd = (n) => (Number.isFinite(n) ? formatAmount(n, 'USD') : null);
  const xlmUsd = fee.xlmUsd ? parseFloat(fee.xlmUsd) : null;
  const feeUsd = xlmUsd ? finiteUsd(toXlmNumber(feeStroops) * xlmUsd) : null;
  const totalUsd = xlmUsd && totalStroops !== null ? finiteUsd(toXlmNumber(totalStroops) * xlmUsd) : null;
  const savingsUsd = fee.feeUsd && feeUsd
    ? finiteUsd(fee.traditionalFeeUsd - toXlmNumber(feeStroops) * xlmUsd)
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
          {feeText} XLM
          {feeUsd && <span className="fee-usd"> ≈ {feeUsd}</span>}
        </span>
      </div>

      {amtNum > 0 && !isNativeAsset && (
        <div className="fee-row">
          <span className="fee-label">Amount</span>
          <span className="fee-val">
            {formatAssetAmount(amtNum)} {assetCode}
          </span>
        </div>
      )}

      {amtNum > 0 && isNativeAsset && (
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
