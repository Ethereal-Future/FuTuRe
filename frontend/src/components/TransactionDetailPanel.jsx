import { useState } from 'react';
import { CopyButton } from './CopyButton';
import { XdrExportModal } from './XdrExportModal';
import { formatAssetAmount } from '../utils/formatAmount';

const TYPE_LABELS = { payment: 'Payment', create_account: 'Account Created', unknown: 'Other' };

function fmtHuman(dateStr) {
  return new Date(dateStr).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtIso(dateStr) {
  return new Date(dateStr).toISOString();
}

/**
 * TransactionDetailPanel — full detail view for a single transaction,
 * rendered inside a SlideOver so the transaction list behind it keeps
 * its scroll position and filter state.
 */
export function TransactionDetailPanel({ tx, network = 'public' }) {
  const [showXdr, setShowXdr] = useState(false);
  const [showXdrExport, setShowXdrExport] = useState(false);

  if (!tx) return null;

  const explorerNetwork = network === 'testnet' ? 'testnet' : 'public';
  const txExplorerUrl = `https://stellar.expert/explorer/${explorerNetwork}/tx/${tx.hash}`;
  const ledgerExplorerUrl = tx.ledger != null
    ? `https://stellar.expert/explorer/${explorerNetwork}/ledger/${tx.ledger}`
    : null;
  const feeXlm = tx.fee != null ? formatAssetAmount(Number(tx.fee) / 1e7) : null;

  return (
    <dl className="tx-detail-list">
      <dt>Type</dt>
      <dd>{TYPE_LABELS[tx.type] ?? tx.type}</dd>

      {tx.direction && (
        <>
          <dt>Direction</dt>
          <dd>{tx.direction}</dd>
        </>
      )}

      {tx.amount && (
        <>
          <dt>Amount</dt>
          <dd>{tx.amount} {tx.asset}</dd>
        </>
      )}

      {tx.counterparty && (
        <>
          <dt>{tx.direction === 'sent' ? 'Recipient' : 'Sender'}</dt>
          <dd className="tx-hash">
            {tx.counterparty}
            <CopyButton text={tx.counterparty} label="Copy address" />
          </dd>
        </>
      )}

      {tx.memo && (
        <>
          <dt>Memo</dt>
          <dd>{tx.memo}</dd>
        </>
      )}

      <dt>Fee</dt>
      <dd>{tx.fee} stroops{feeXlm ? ` (${feeXlm} XLM)` : ''}</dd>

      {tx.ledger != null && (
        <>
          <dt>Ledger</dt>
          <dd>
            {ledgerExplorerUrl
              ? <a href={ledgerExplorerUrl} target="_blank" rel="noopener noreferrer">{tx.ledger} ↗</a>
              : tx.ledger}
          </dd>
        </>
      )}

      <dt>Hash</dt>
      <dd className="tx-hash">
        <a href={txExplorerUrl} target="_blank" rel="noopener noreferrer">{tx.hash}</a>
        <CopyButton text={tx.hash} label="Copy transaction hash" />
      </dd>

      <dt>Timestamp</dt>
      <dd>
        {fmtHuman(tx.date)}
        <br />
        <span className="tx-timestamp-iso">{fmtIso(tx.date)}</span>
      </dd>

      <dt>Status</dt>
      <dd className={tx.successful ? 'tx-ok' : 'tx-fail'}>
        {tx.successful ? '✓ Confirmed' : '✗ Failed'}
      </dd>

      {tx.envelopeXdr && (
        <>
          <dt>Raw XDR</dt>
          <dd>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button type="button" className="tx-xdr-toggle" onClick={() => setShowXdr(s => !s)}>
                {showXdr ? 'Hide' : 'View'} raw XDR envelope
              </button>
              <button
                type="button"
                className="tx-xdr-export-btn"
                onClick={() => setShowXdrExport(true)}
                title="Export and share this transaction XDR"
              >
                📦 Export
              </button>
            </div>
            {showXdr && <pre className="tx-xdr-envelope">{tx.envelopeXdr}</pre>}
          </dd>
        </>
      )}

      <XdrExportModal
        open={showXdrExport}
        onClose={() => setShowXdrExport(false)}
        xdr={tx.envelopeXdr}
        isSigned={tx.successful !== false}
        isTestnet={network === 'testnet'}
      />
    </dl>
  );
}
