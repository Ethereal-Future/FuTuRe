import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseSep7Uri, extractOriginDomain } from '../utils/sep7Parser';
import { Modal } from '../design-system/Modal';

export function Sep7UriHandler({ uri, onLoad, onError, onClose }) {
  const { t } = useTranslation();
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!uri) return;

    const result = parseSep7Uri(uri);
    setParsed(result);

    if (!result.valid) {
      setError(result.error);
      onError?.(result.error);
    } else {
      setError(null);
      onLoad?.(result);
    }
  }, [uri, onLoad, onError]);

  if (!parsed) return null;

  if (!parsed.valid) {
    return (
      <Modal open={true} onClose={onClose} title={t('sep7.invalidTitle')} size="sm">
        <div style={{ padding: '16px', color: '#dc2626' }}>
          <p style={{ marginTop: 0 }}>
            <strong>{t('sep7.errorLabel')}</strong> {error}
          </p>
          <button type="button" onClick={onClose} style={{ marginTop: 16 }}>
            {t('common.close')}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={true} onClose={onClose} title={t('sep7.title')} size="sm">
      <div className="sep7-handler">
        {parsed.originDomain && (
          <div style={{
            background: '#f0f9ff',
            border: '1px solid #bfdbfe',
            borderRadius: 6,
            padding: 12,
            marginBottom: 16,
          }}>
            <p style={{ margin: 0, fontSize: '0.9rem', color: '#1e40af' }}>
              <strong>{t('sep7.originLabel')}</strong> {parsed.originDomain}
            </p>
          </div>
        )}

        {parsed.message && (
          <div style={{
            background: '#fef3c7',
            border: '1px solid #fcd34d',
            borderRadius: 6,
            padding: 12,
            marginBottom: 16,
          }}>
            <p style={{ margin: 0, fontSize: '0.9rem', color: '#78350f' }}>
              <strong>{t('sep7.messageLabel')}</strong> {parsed.message}
            </p>
          </div>
        )}

        <dl style={{ marginBottom: 16 }}>
          <dt style={{ fontWeight: 600, marginTop: 12 }}>{t('sep7.recipient')}</dt>
          <dd style={{ fontFamily: 'monospace', fontSize: '0.85rem', wordBreak: 'break-all' }}>
            {parsed.destination}
          </dd>

          {parsed.amount && (
            <>
              <dt style={{ fontWeight: 600, marginTop: 12 }}>{t('sep7.amount')}</dt>
              <dd>{parsed.amount} {parsed.assetCode}</dd>
            </>
          )}

          {parsed.memo && (
            <>
              <dt style={{ fontWeight: 600, marginTop: 12 }}>{t('sep7.memo')}</dt>
              <dd>
                <div style={{ fontSize: '0.85rem', color: '#666' }}>
                  {t('sep7.typeLabel')} <strong>{parsed.memoType}</strong>
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', wordBreak: 'break-all' }}>
                  {parsed.memo}
                </div>
              </dd>
            </>
          )}

          {parsed.assetCode !== 'XLM' && parsed.assetIssuer && (
            <>
              <dt style={{ fontWeight: 600, marginTop: 12 }}>{t('sep7.assetIssuer')}</dt>
              <dd style={{ fontFamily: 'monospace', fontSize: '0.85rem', wordBreak: 'break-all' }}>
                {parsed.assetIssuer}
              </dd>
            </>
          )}
        </dl>

        <div style={{ background: '#f3f4f6', borderRadius: 6, padding: 12, marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#6b7280' }}>
            {t('sep7.prefillNotice')}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => onLoad?.(parsed)}
            style={{
              flex: 1,
              padding: '10px 16px',
              background: '#0066cc',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {t('common.continue')}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 16px',
              background: '#e5e7eb',
              color: '#1f2937',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
