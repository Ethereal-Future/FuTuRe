import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from './CopyButton';
import { XdrExportModal } from './XdrExportModal';
import { formatAssetAmount } from '../utils/formatAmount';

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
  const { t } = useTranslation();
  const [showXdr, setShowXdr] = useState(false);
  const [showXdrExport, setShowXdrExport] = useState(false);

  if (!tx) return null;

  const TYPE_LABELS = {
    payment: t('txDetail.typePayment'),
    create_account: t('txDetail.typeCreateAccount'),
    unknown: t('txDetail.typeOther'),
  };

  const explorerNetwork = network === 'testnet' ? 'testnet' : 'public';
  const txExplorerUrl = `https://stellar.expert/explorer/${explorerNetwork}/tx/${tx.hash}`;
  const ledgerExplorerUrl = tx.ledger != null
    ? `https://stellar.expert/explorer/${explorerNetwork}/ledger/${tx.ledger}`
    : null;
  const feeXlm = tx.fee != null ? formatAssetAmount(Number(tx.fee) / 1e7) : null;

  return (
    <dl className="tx-detail-list">
      <dt>{t('txDetail.type')}</dt>
      <dd>{TYPE_LABELS[tx.type] ?? tx.type}</dd>

      {tx.direction && (
        <>
          <dt>{t('txDetail.direction')}</dt>
          <dd>{tx.direction}</dd>
        </>
      )}

      {tx.amount && (
        <>
          <dt>{t('txDetail.amount')}</dt>
          <dd>{tx.amount} {tx.asset}</dd>
        </>
      )}

      {tx.counterparty && (
        <>
          <dt>{tx.direction === 'sent' ? t('txDetail.recipient') : t('txDetail.sender')}</dt>
          <dd className="tx-hash">
            {tx.counterparty}
            <CopyButton text={tx.counterparty} label={t('txDetail.copyAddress')} />
          </dd>
        </>
      )}

      {tx.memo && (
        <>
          <dt>{t('txDetail.memo')}</dt>
          <dd>{tx.memo}</dd>
        </>
      )}

      <dt>{t('txDetail.fee')}</dt>
      <dd>{tx.fee} {t('txDetail.stroops')}{feeXlm ? ` (${feeXlm} XLM)` : ''}</dd>

      {tx.ledger != null && (
        <>
          <dt>{t('txDetail.ledger')}</dt>
          <dd>
            {ledgerExplorerUrl
              ? <a href={ledgerExplorerUrl} target="_blank" rel="noopener noreferrer">{tx.ledger} ↗</a>
              : tx.ledger}
          </dd>
        </>
      )}

      <dt>{t('txDetail.hash')}</dt>
      <dd className="tx-hash">
        <a href={txExplorerUrl} target="_blank" rel="noopener noreferrer">{tx.hash}</a>
        <CopyButton text={tx.hash} label={t('txDetail.copyTransactionHash')} />
      </dd>

      <dt>{t('txDetail.timestamp')}</dt>
      <dd>
        {fmtHuman(tx.date)}
        <br />
        <span className="tx-timestamp-iso">{fmtIso(tx.date)}</span>
      </dd>

      <dt>{t('txDetail.status')}</dt>
      <dd className={tx.successful ? 'tx-ok' : 'tx-fail'}>
        {tx.successful ? t('txDetail.confirmed') : t('txDetail.failed')}
      </dd>

      {tx.envelopeXdr && (
        <>
          <dt>{t('txDetail.rawXdr')}</dt>
          <dd>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button type="button" className="tx-xdr-toggle" onClick={() => setShowXdr(s => !s)}>
                {showXdr ? t('txDetail.hide') : t('txDetail.view')} {t('txDetail.rawXdrEnvelope')}
              </button>
              <button
                type="button"
                className="tx-xdr-export-btn"
                onClick={() => setShowXdrExport(true)}
                title={t('txDetail.exportTitle')}
              >
                {t('txDetail.export')}
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
