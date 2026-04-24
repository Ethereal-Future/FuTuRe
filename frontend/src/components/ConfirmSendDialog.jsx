import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Modal } from '../design-system/Modal';

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
 */
export function ConfirmSendDialog({ open, onConfirm, onCancel, recipient, amount, asset = 'XLM' }) {
  const [fee, setFee] = useState(null);
  const [usdRate, setUsdRate] = useState(null);
  const cache = useRef({});

  useEffect(() => {
    if (!open) return;

    if (!cache.current.fee) {
      axios.get('/api/stellar/fee-stats')
        .then(({ data }) => { cache.current.fee = data; setFee(data); })
        .catch(() => {});
    } else {
      setFee(cache.current.fee);
    }

    if (!cache.current.rate) {
      axios.get('/api/stellar/exchange-rate/XLM/USD')
        .then(({ data }) => { cache.current.rate = data.rate; setUsdRate(data.rate); })
        .catch(() => {});
    } else {
      setUsdRate(cache.current.rate);
    }
  }, [open]);

  const amtNum = parseFloat(amount) || 0;
  const feeXLM = fee ? parseFloat(fee.feeXLM) : null;
  const totalXLM = feeXLM !== null ? (amtNum + feeXLM).toFixed(7).replace(/\.?0+$/, '') : null;
  const amtUsd = usdRate ? (amtNum * usdRate).toFixed(2) : null;

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
            {amtUsd && <span className="confirm-dialog__usd"> ≈ ${amtUsd} USD</span>}
          </dd>
        </div>
        <div className="confirm-dialog__row">
          <dt>Estimated fee</dt>
          <dd>
            {feeXLM !== null
              ? <>{feeXLM} XLM{fee?.feeUsd && <span className="confirm-dialog__usd"> ≈ ${fee.feeUsd} USD</span>}</>
              : '—'}
          </dd>
        </div>
        {totalXLM && (
          <div className="confirm-dialog__row confirm-dialog__row--total">
            <dt>Total deducted</dt>
            <dd>{totalXLM} {asset}</dd>
          </div>
        )}
      </dl>
      <div className="confirm-dialog__actions">
        <button type="button" onClick={onConfirm} className="confirm-dialog__btn-confirm">
          Confirm &amp; Send
        </button>
        <button type="button" onClick={onCancel} className="confirm-dialog__btn-cancel btn-clear">
          Cancel
        </button>
      </div>
    </Modal>
  );
}
