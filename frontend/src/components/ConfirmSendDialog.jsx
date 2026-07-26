import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client.js';
import { Modal } from '../design-system/Modal';
import { XLMInfoIcon } from './XLMInfoIcon';
import { XdrExportModal } from './XdrExportModal';

function truncate(addr) {
  if (!addr || addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

/**
 * ConfirmSendDialog — shows a summary of the pending payment and requires
 * explicit confirmation before the transaction is submitted.
 *
 * @param {boolean}    open
 * @param {() => void} onConfirm
 * @param {() => void} onCancel
 * @param {string}     recipient
 * @param {string}     amount
 * @param {string}     asset
 * @param {string}     sourceSecret
 * @param {string}     memo
 * @param {string}     memoType
 */
export function ConfirmSendDialog({ open, onConfirm, onCancel, recipient, amount, asset = 'XLM', sourceSecret, memo, memoType }) {
  const [fee, setFee] = useState(null);
  const [usdRate, setUsdRate] = useState(null);
  const [showXdrExport, setShowXdrExport] = useState(false);
  const [unsignedXdr, setUnsignedXdr] = useState(null);
  const [buildingXdr, setBuildingXdr] = useState(false);
  const cache = useRef({});

  useEffect(() => {
    if (!open) return;

    if (!cache.current.fee) {
      apiClient.get('/api/stellar/fee-stats')
        .then(({ data }) => { cache.current.fee = data; setFee(data); })
        .catch(() => {});
    } else {
      setFee(cache.current.fee);
    }

    if (!cache.current.rate) {
      apiClient.get('/api/stellar/exchange-rate/XLM/USD')
        .then(({ data }) => { cache.current.rate = data.rate; setUsdRate(data.rate); })
        .catch(() => {});
    } else {
      setUsdRate(cache.current.rate);
    }
  }, [open]);

  const amtNum = parseFloat(amount) || 0;
  const feeXLM = fee ? parseFloat(fee.feeXLM) : null;
  const baseFeeXLM = fee ? parseFloat(fee.baseFeeXLM) : null;
  const surgeMultiplier = fee ? parseFloat(fee.surgeMultiplier) : null;
  const totalXLM = feeXLM !== null ? (amtNum + feeXLM).toFixed(7).replace(/\.?0+$/, '') : null;
  const amtUsd = usdRate ? (amtNum * usdRate).toFixed(2) : null;

  const handleExportXdr = async () => {
    if (unsignedXdr) {
      setShowXdrExport(true);
      return;
    }

    setBuildingXdr(true);
    try {
      const { data } = await apiClient.post('/api/stellar/transaction/build-unsigned-xdr', {
        sourceSecret,
        destination: recipient,
        amount,
        assetCode: asset,
        memo: memo || undefined,
        memoType: memoType || undefined,
      });
      setUnsignedXdr(data.xdr);
      setShowXdrExport(true);
    } catch (error) {
      console.error('Failed to build unsigned XDR:', error);
    } finally {
      setBuildingXdr(false);
    }
  };

  return (
    <Modal open={open} onClose={onCancel} title="Confirm Payment" size="sm">
      <dl className="confirm-dialog__summary">
        <div className="confirm-dialog__row">
          <dt>Recipient</dt>
          <dd title={recipient}>{truncate(recipient)}</dd>
        </div>
        <div className="confirm-dialog__row">
          <dt>Amount</dt>
          <dd>
            {amount} {asset}
            {asset === 'XLM' && <XLMInfoIcon />}
            {amtUsd && <span className="confirm-dialog__usd"> ≈ ${amtUsd} USD</span>}
          </dd>
        </div>
        {baseFeeXLM !== null && (
          <div className="confirm-dialog__row">
            <dt>Base fee</dt>
            <dd>{baseFeeXLM} XLM</dd>
          </div>
        )}
        {surgeMultiplier !== null && surgeMultiplier > 1 && (
          <div className="confirm-dialog__row">
            <dt>Surge multiplier</dt>
            <dd>{surgeMultiplier}x</dd>
          </div>
        )}
        <div className="confirm-dialog__row">
          <dt>Transaction fee</dt>
          <dd>
            {feeXLM !== null
              ? <>{feeXLM} XLM<XLMInfoIcon />{fee?.feeUsd && <span className="confirm-dialog__usd"> ≈ ${fee.feeUsd} USD</span>}</>
              : '—'}
          </dd>
        </div>
        {totalXLM && (
          <div className="confirm-dialog__row confirm-dialog__row--total">
            <dt>Total deducted</dt>
            <dd>{totalXLM} {asset}{asset === 'XLM' && <XLMInfoIcon />}</dd>
          </div>
        )}
      </dl>
      <div className="confirm-dialog__actions">
        <button type="button" onClick={onConfirm} className="confirm-dialog__btn-confirm">
          Confirm &amp; Send
        </button>
        <button
          type="button"
          onClick={handleExportXdr}
          disabled={buildingXdr}
          className="confirm-dialog__btn-export"
          title="Export this transaction as XDR for signing with hardware wallets or multisig"
        >
          {buildingXdr ? 'Building XDR…' : '📦 Export as XDR'}
        </button>
        <button type="button" onClick={onCancel} className="confirm-dialog__btn-cancel btn-clear">
          Cancel
        </button>
      </div>

      <XdrExportModal
        open={showXdrExport}
        onClose={() => setShowXdrExport(false)}
        xdr={unsignedXdr}
        isSigned={false}
      />
    </Modal>
  );
}
