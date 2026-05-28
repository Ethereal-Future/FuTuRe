import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { AnimatePresence, motion } from 'framer-motion';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { isValidStellarAddress } from '../utils/validateStellarAddress';

const TYPE_LABELS = { payment: 'Payment', create_account: 'Account Created', unknown: 'Other' };

function fmt(dateStr) {
  return new Date(dateStr).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * TxLookup — modal that fetches a transaction by hash and shows its details.
 *
 * Props:
 *   initialHash      – pre-filled hash (e.g. from URL deep-link #tx=<hash>)
 *   accountPublicKey – if an account is already loaded, skip the public-key field
 *   onClose          – called when the user dismisses the modal
 */
export function TxLookup({ initialHash = '', accountPublicKey = '', onClose }) {
  const [hash, setHash] = useState(initialHash);
  const [publicKey, setPublicKey] = useState(accountPublicKey);
  const [tx, setTx] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const modalRef = useRef(null);
  useFocusTrap(modalRef, true);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Auto-fetch when opened with a pre-filled hash + known account
  useEffect(() => {
    if (initialHash && accountPublicKey) lookup(initialHash, accountPublicKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function lookup(h = hash, pk = publicKey) {
    const trimH = h.trim();
    const trimPk = pk.trim();
    if (!trimH || !trimPk) return;
    setLoading(true);
    setError('');
    setTx(null);
    try {
      const { data } = await axios.get(`/api/stellar/account/${trimPk}/transactions`, {
        params: { hash: trimH, limit: 50 },
      });
      const found = data.records?.find(r => r.hash?.toLowerCase() === trimH.toLowerCase());
      if (found) {
        setTx(found);
      } else {
        setError('Transaction not found for this account.');
      }
    } catch (e) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Lookup failed.');
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = (e) => { e.preventDefault(); lookup(); };

  return (
    <motion.div
      className="tx-overlay"
      onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        ref={modalRef}
        className="tx-modal"
        onClick={e => e.stopPropagation()}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tx-lookup-title"
      >
        <div className="tx-modal-header">
          <h3 id="tx-lookup-title">{tx ? 'Transaction Details' : 'Look Up Transaction'}</h3>
          <button className="qr-close" onClick={onClose} aria-label="Close transaction lookup">✕</button>
        </div>

        {!tx ? (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!accountPublicKey && (
              <>
                <label htmlFor="tl-pubkey" className="sr-only">Account public key</label>
                <input
                  id="tl-pubkey"
                  type="text"
                  placeholder="Account Public Key (G…)"
                  value={publicKey}
                  onChange={e => setPublicKey(e.target.value)}
                  spellCheck={false}
                  aria-label="Account public key"
                  style={{ border: `2px solid ${publicKey && !isValidStellarAddress(publicKey) ? '#ef4444' : '#ccc'}` }}
                />
              </>
            )}
            <label htmlFor="tl-hash" className="sr-only">Transaction hash</label>
            <input
              id="tl-hash"
              type="text"
              placeholder="Transaction hash"
              value={hash}
              onChange={e => setHash(e.target.value)}
              spellCheck={false}
              aria-label="Transaction hash"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus={!initialHash}
            />
            {error && <p className="field-error" role="alert">{error}</p>}
            <button
              type="submit"
              disabled={loading || !hash.trim() || !publicKey.trim()}
              aria-busy={loading}
            >
              {loading ? 'Looking up…' : 'Look Up'}
            </button>
          </form>
        ) : (
          <>
            <dl className="tx-detail-list">
              <dt>Hash</dt><dd className="tx-hash">{tx.hash}</dd>
              <dt>Type</dt><dd>{TYPE_LABELS[tx.type] ?? tx.type}</dd>
              {tx.direction && <><dt>Direction</dt><dd>{tx.direction}</dd></>}
              {tx.amount && <><dt>Amount</dt><dd>{tx.amount} {tx.asset}</dd></>}
              {tx.counterparty && <><dt>Counterparty</dt><dd className="tx-hash">{tx.counterparty}</dd></>}
              <dt>Date</dt><dd>{fmt(tx.date)}</dd>
              <dt>Fee</dt><dd>{tx.fee} stroops</dd>
              {tx.memo && <><dt>Memo</dt><dd>{tx.memo}</dd></>}
              <dt>Status</dt><dd>{tx.successful ? '✓ Success' : '✗ Failed'}</dd>
            </dl>
            <button
              type="button"
              style={{ marginTop: 12 }}
              onClick={() => setTx(null)}
              aria-label="Look up another transaction"
            >
              ← Look up another
            </button>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
