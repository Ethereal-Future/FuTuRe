import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../design-system/Modal';
import { downloadFile, copyToClipboard, generateStellarLabUrl, formatXdrForDisplay } from '../utils/xdrExport';

export function XdrExportModal({ open, onClose, xdr, isSigned = true, isTestnet = false }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  if (!xdr) return null;

  const handleCopyXdr = async () => {
    const success = await copyToClipboard(xdr);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadXdr = () => {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `stellar-tx-${isSigned ? 'signed' : 'unsigned'}-${timestamp}.xdr`;
    downloadFile(xdr, filename, 'text/plain');
  };

  const handleOpenInLab = () => {
    const labUrl = generateStellarLabUrl(xdr, isTestnet);
    window.open(labUrl, '_blank', 'noopener,noreferrer');
  };

  const displayXdr = formatXdrForDisplay(xdr, 80);

  return (
    <Modal open={open} onClose={onClose} title={t('xdrExport.title')} size="lg">
      <div className="xdr-export-modal">
        <div className="xdr-status">
          <p>
            <strong>{t('xdrExport.statusLabel')}</strong> {isSigned ? t('xdrExport.signed') : t('xdrExport.unsigned')}
          </p>
          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: 8 }}>
            {isSigned ? t('xdrExport.signedHint') : t('xdrExport.unsignedHint')}
          </p>
        </div>

        <div className="xdr-display">
          <label htmlFor="xdr-textarea" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
            {t('xdrExport.envelopeLabel')}
          </label>
          <textarea
            id="xdr-textarea"
            value={displayXdr}
            readOnly
            style={{
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              width: '100%',
              height: 200,
              padding: 12,
              border: '1px solid #ccc',
              borderRadius: 4,
              backgroundColor: '#f9f9f9',
              resize: 'vertical',
              wordBreak: 'break-all',
            }}
          />
        </div>

        <div className="xdr-actions">
          <button
            type="button"
            onClick={handleCopyXdr}
            className="btn-primary"
            style={{ background: copied ? '#10b981' : undefined }}
          >
            {copied ? t('xdrExport.copied') : t('xdrExport.copy')}
          </button>
          <button
            type="button"
            onClick={handleDownloadXdr}
            className="btn-secondary"
          >
            {t('xdrExport.download')}
          </button>
          <button
            type="button"
            onClick={handleOpenInLab}
            className="btn-secondary"
          >
            {t('xdrExport.openInLab')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-clear"
          >
            {t('common.close')}
          </button>
        </div>

        <style>{`
          .xdr-export-modal {
            display: flex;
            flex-direction: column;
            gap: 16px;
          }
          .xdr-status {
            background: #f0f9ff;
            border: 1px solid #bfdbfe;
            border-radius: 6px;
            padding: 12px;
            color: #1e40af;
          }
          .xdr-status p {
            margin: 0;
            font-size: 0.9rem;
          }
          .xdr-display {
            margin: 12px 0;
          }
          .xdr-actions {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
          }
          .xdr-actions button {
            padding: 8px 16px;
            border-radius: 4px;
            border: none;
            cursor: pointer;
            font-size: 0.9rem;
            transition: background 0.2s;
          }
          .btn-primary {
            background: #3b82f6;
            color: white;
          }
          .btn-primary:hover {
            background: #2563eb;
          }
          .btn-secondary {
            background: #e5e7eb;
            color: #1f2937;
          }
          .btn-secondary:hover {
            background: #d1d5db;
          }
          .btn-clear {
            background: transparent;
            border: 1px solid #d1d5db;
            color: #6b7280;
          }
          .btn-clear:hover {
            background: #f9fafb;
          }
        `}</style>
      </div>
    </Modal>
  );
}
