import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TransactionBuilder } from '@stellar/stellar-sdk';
import { parseSep7Uri, extractOriginDomain } from '../utils/sep7Parser';
import { Modal } from '../design-system/Modal';

const DEFAULT_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

function getNetworkPassphrase() {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || DEFAULT_NETWORK_PASSPHRASE;
  }
  return DEFAULT_NETWORK_PASSPHRASE;
}

function isHttpUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function decodeTransaction(xdr) {
  const tx = TransactionBuilder.fromXDR(xdr, getNetworkPassphrase());
  return tx;
}

export function Sep7UriHandler({ uri, onLoad, onError, onClose, signTransaction }) {
  const { t } = useTranslation();
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState(null);
  const [decodedTx, setDecodedTx] = useState(null);
  const [decodeError, setDecodeError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!uri) return;

    const result = parseSep7Uri(uri);
    setParsed(result);
    setDecodedTx(null);
    setDecodeError(null);
    setStatus(null);

    if (!result.valid) {
      setError(result.error);
      onError?.(result.error);
      return;
    }

    setError(null);

    if (result.operation === 'tx') {
      try {
        const tx = decodeTransaction(result.xdr);
        setDecodedTx(tx);
      } catch (err) {
        const message = err?.message || t('sep7.txDecodeError');
        setDecodeError(message);
        onError?.(message);
        return;
      }
    }

    onLoad?.(result);
  }, [uri, onLoad, onError, t]);

  const handleTxContinue = async () => {
    if (!decodedTx || !parsed) return;

    if (!signTransaction) {
      const message = t('sep7.txSignUnavailable');
      setStatus({ type: 'error', message });
      onError?.(message);
      return;
    }

    setSubmitting(true);
    setStatus(null);

    try {
      const signedXdr = await signTransaction(decodedTx.toXDR());

      if (parsed.callbackUrl) {
        if (!isHttpUrl(parsed.callbackUrl)) {
          const message = t('sep7.txCallbackInvalid');
          setStatus({ type: 'error', message });
          onError?.(message);
          return;
        }

        const response = await fetch(parsed.callbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ xdr: signedXdr }),
        });

        if (!response.ok) {
          throw new Error(`${t('sep7.txCallbackFailed')} (${response.status})`);
        }

        setStatus({ type: 'success', message: t('sep7.txCallbackSuccess') });
      } else {
        setStatus({ type: 'success', message: t('sep7.txSignedSuccess') });
      }

      onLoad?.({ ...parsed, signedXdr });
    } catch (err) {
      const message = err?.message || t('sep7.txSubmitError');
      setStatus({ type: 'error', message });
      onError?.(message);
    } finally {
      setSubmitting(false);
    }
  };

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

  if (parsed.operation === 'tx') {
    return (
      <Modal open={true} onClose={onClose} title={t('sep7.txTitle')} size="sm">
        <div className="sep7-handler">
          {parsed.originDomain && (
            <div style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 6,
              padding: 12,
              marginBottom: 16,
            }}>
              <p style={{ margin: 0, fontSize: '0.9rem', color: '#991b1b' }}>
                <strong>{t('sep7.originLabelUnverified')}</strong> {parsed.originDomain}
              </p>
              <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#991b1b' }}>
                {t('sep7.originUnverifiedWarning')}
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

          {decodeError && (
            <div style={{ padding: '16px', color: '#dc2626' }}>
              <p style={{ marginTop: 0 }}>
                <strong>{t('sep7.errorLabel')}</strong> {decodeError}
              </p>
            </div>
          )}

          {decodedTx && (
            <dl style={{ marginBottom: 16 }}>
              <dt style={{ fontWeight: 600, marginTop: 12 }}>{t('sep7.txSourceAccount')}</dt>
              <dd style={{ fontFamily: 'monospace', fontSize: '0.85rem', wordBreak: 'break-all' }}>
                {decodedTx.source}
              </dd>

              <dt style={{ fontWeight: 600, marginTop: 12 }}>{t('sep7.txSequence')}</dt>
              <dd style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                {decodedTx.sequence}
              </dd>

              <dt style={{ fontWeight: 600, marginTop: 12 }}>{t('sep7.txFee')}</dt>
              <dd>{decodedTx.fee}</dd>

              <dt style={{ fontWeight: 600, marginTop: 12 }}>{t('sep7.txTimeBounds')}</dt>
              <dd style={{ fontSize: '0.85rem' }}>
                {decodedTx.timebounds
                  ? `${decodedTx.timebounds.minTime} - ${decodedTx.timebounds.maxTime}`
                  : t('sep7.txTimeBoundsNone')}
              </dd>

              <dt style={{ fontWeight: 600, marginTop: 12 }}>{t('sep7.txOperations')}</dt>
              <dd>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {decodedTx.operations.map((op, index) => (
                    <li key={index} style={{ fontSize: '0.85rem', marginBottom: 6 }}>
                      <strong>{op.type}</strong>
                      {op.destination && (
                        <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                          {t('sep7.recipient')}: {op.destination}
                        </div>
                      )}
                      {op.amount && (
                        <div>
                          {t('sep7.amount')}: {op.amount} {op.asset?.code || 'XLM'}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </dd>
            </dl>
          )}

          {parsed.callbackUrl && (
            <div style={{ background: '#f3f4f6', borderRadius: 6, padding: 12, marginBottom: 16 }}>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#6b7280' }}>
                {t('sep7.txCallbackNotice')}
              </p>
            </div>
          )}

          {status && (
            <div
              style={{
                background: status.type === 'error' ? '#fef2f2' : '#ecfdf5',
                border: `1px solid ${status.type === 'error' ? '#fecaca' : '#a7f3d0'}`,
                borderRadius: 6,
                padding: 12,
                marginBottom: 16,
                color: status.type === 'error' ? '#991b1b' : '#065f46',
                fontSize: '0.85rem',
              }}
            >
              {status.message}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={handleTxContinue}
              disabled={!decodedTx || submitting}
              style={{
                flex: 1,
                padding: '10px 16px',
                background: '#0066cc',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: !decodedTx || submitting ? 'not-allowed' : 'pointer',
                opacity: !decodedTx || submitting ? 0.6 : 1,
              }}
            >
              {submitting ? t('sep7.txSubmitting') : t('common.continue')}
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

  return (
    <Modal open={true} onClose={onClose} title={t('sep7.title')} size="sm">
      <div className="sep7-handler">
        {parsed.originDomain && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 6,
            padding: 12,
            marginBottom: 16,
          }}>
            <p style={{ margin: 0, fontSize: '0.9rem', color: '#991b1b' }}>
              <strong>{t('sep7.originLabelUnverified')}</strong> {parsed.originDomain}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#991b1b' }}>
              {t('sep7.originUnverifiedWarning')}
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
