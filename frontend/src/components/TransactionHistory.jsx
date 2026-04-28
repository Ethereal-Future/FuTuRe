import { useState, useCallback, useRef, useEffect } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { Spinner } from './Spinner';
import { useFocusTrap } from '../hooks/useFocusTrap';

const TYPE_LABELS = { payment: 'Payment', create_account: 'Account Created', unknown: 'Other' };
const PAGE_SIZE = 10;

function fmt(dateStr) {
  return new Date(dateStr).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function TxRow({ tx, onClick, onRetry }) {
function csvEscape(val) {
  const s = val == null ? '' : String(val);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

async function fetchAllTransactions(publicKey) {
  const all = [];
  let cursor = null;
  do {
    const params = { limit: 50, ...(cursor ? { cursor } : {}) };
    const { data } = await axios.get(`/api/stellar/account/${publicKey}/transactions`, { params });
    all.push(...(data.records ?? []));
    cursor = data.nextCursor ?? null;
  } while (cursor);
  return all;
}

function downloadCsv(rows, filename) {
  const COLS = ['date', 'type', 'direction', 'amount', 'asset', 'counterparty', 'hash', 'fee', 'status'];
  const lines = [
    COLS.join(','),
    ...rows.map(tx => [
      tx.date ? new Date(tx.date).toISOString() : '',
      TYPE_LABELS[tx.type] ?? tx.type ?? '',
      tx.direction ?? '',
      tx.amount ?? '',
      tx.asset ?? 'XLM',
      tx.counterparty ?? '',
      tx.hash ?? '',
      tx.fee ?? '',
      tx.successful ? 'success' : 'failed',
    ].map(csvEscape).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function TxRow({ tx, onClick }) {
  const isReceived = tx.direction === 'received';
  const isSent = tx.direction === 'sent';
  const label = `${TYPE_LABELS[tx.type] ?? tx.type}, ${tx.direction ?? ''}, ${tx.amount ? `${tx.amount} ${tx.asset ?? 'XLM'}` : ''}, ${fmt(tx.date)}, ${tx.successful ? 'successful' : 'failed'}`;

  return (
    <motion.div
      className="tx-row"
      onClick={() => onClick(tx)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick(tx)}
      whileTap={{ scale: 0.98 }}
      layout
      role="button"
      tabIndex={0}
      aria-label={label}
    >
      <span className={`tx-dir ${isReceived ? 'tx-in' : isSent ? 'tx-out' : 'tx-neutral'}`} aria-hidden="true">
        {isReceived ? '↓' : isSent ? '↑' : '•'}
      </span>
      <span className="tx-type">{TYPE_LABELS[tx.type] ?? tx.type}</span>
      <span className="tx-amount">
        {tx.amount ? `${tx.amount} ${tx.asset ?? ''}` : '—'}
      </span>
      <span className="tx-date">{fmt(tx.date)}</span>
      <span className={`tx-status ${tx.successful ? 'tx-ok' : 'tx-fail'}`} aria-hidden="true">
        {tx.successful ? '✓' : '✗'}
      </span>
      {!tx.successful && onRetry && (
        <button
          className="tx-retry-btn"
          onClick={(e) => { e.stopPropagation(); onRetry(tx); }}
          aria-label={`Retry failed transaction ${tx.hash}`}
        >
          Retry
        </button>
      )}
    </motion.div>
  );
}

function TxModal({ tx, onClose }) {
  const modalRef = useRef(null);
  useFocusTrap(modalRef, true);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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
        aria-labelledby="tx-modal-title"
      >
        <div className="tx-modal-header">
          <h3 id="tx-modal-title">Transaction Details</h3>
          <button className="qr-close" onClick={onClose} aria-label="Close transaction details dialog">✕</button>
        </div>
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
      </motion.div>
    </motion.div>
  );
}

export function TransactionHistory({ publicKey }) {
  const [txs, setTxs] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ type: '', dateFrom: '', dateTo: '', hash: '' });
  const [cursors, setCursors] = useState([]); // ring-buffer for back-pagination (max 50)
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState({}); // { [txId]: 'pending' | 'success' | 'error' }
  const [exporting, setExporting] = useState(false);

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const all = await fetchAllTransactions(publicKey);
      const date = new Date().toISOString().slice(0, 10);
      downloadCsv(all, `transactions-${publicKey.slice(0, 8)}-${date}.csv`);
    } catch (e) {
      setError(e?.response?.data?.error ?? e.message);
    } finally {
      setExporting(false);
    }
  };

  const MAX_CURSOR_HISTORY = 50;

  const fetchPage = useCallback(async (cursor = null, isBack = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) };
      if (filters.type) params.type = filters.type;
      if (filters.dateFrom) params.dateFrom = filters.dateFrom;
      if (filters.dateTo) params.dateTo = filters.dateTo;
      if (filters.hash) params.hash = filters.hash;
      const { data } = await axios.get(`/api/stellar/account/${publicKey}/transactions`, { params });
      setTxs(data.records);
      setNextCursor(data.nextCursor);
      setLoaded(true);

      if (!isBack && cursor) {
        setCursors(prev => {
          const next = [...prev, cursor];
          return next.length > MAX_CURSOR_HISTORY ? next.slice(next.length - MAX_CURSOR_HISTORY) : next;
        });
      }
    } catch (e) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to load transactions.');
    } finally {
      setLoading(false);
    }
  }, [publicKey, filters]);

  const handleLoad = () => { setCursors([]); fetchPage(null); };
  const handleNext = () => fetchPage(nextCursor);
  const handleBack = () => {
    const prev = cursors[cursors.length - 2] ?? null;
    setCursors(c => c.slice(0, -1));
    fetchPage(prev, true);
  };
  const applyFilters = (e) => { e.preventDefault(); setCursors([]); fetchPage(null); };

  const handleRetry = useCallback(async (tx) => {
    setRetrying(r => ({ ...r, [tx.id]: 'pending' }));
    try {
      await axios.post('/api/retry/transaction', { transactionHash: tx.hash });
      setRetrying(r => ({ ...r, [tx.id]: 'success' }));
      setTxs(prev => prev.map(t => t.id === tx.id ? { ...t, successful: true } : t));
    } catch {
      setRetrying(r => ({ ...r, [tx.id]: 'error' }));
    }
  }, []);

  return (
    <section className="section" aria-labelledby="tx-history-heading">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 id="tx-history-heading">Transaction History</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <motion.button
            onClick={handleExportCsv}
            disabled={exporting || loading}
            whileTap={{ scale: 0.97 }}
            aria-label="Export transaction history as CSV"
            aria-busy={exporting}
            style={{ background: '#16a34a' }}
          >
            {exporting ? <Spinner label="Exporting…" /> : '⬇ Export CSV'}
          </motion.button>
          <motion.button
            className="tx-load-btn"
            onClick={handleLoad}
            disabled={loading}
            whileTap={{ scale: 0.97 }}
            aria-label={loaded ? 'Refresh transaction history' : 'Load transaction history'}
          >
            {loading ? <Spinner label="Loading transactions…" /> : loaded ? '↺ Refresh' : 'Load History'}
          </motion.button>
        </div>
      </div>

      <form className="tx-filters" onSubmit={applyFilters} aria-label="Filter transactions">
        <label htmlFor="tx-type-filter" className="sr-only">Transaction type</label>
        <select
          id="tx-type-filter"
          value={filters.type}
          onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}
          aria-label="Filter by transaction type"
        >
          <option value="">All types</option>
          <option value="payment">Payment</option>
          <option value="create_account">Account Created</option>
        </select>
        <label htmlFor="tx-date-from" className="sr-only">From date</label>
        <input
          id="tx-date-from"
          type="date"
          value={filters.dateFrom}
          onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
          aria-label="Filter from date"
        />
        <label htmlFor="tx-date-to" className="sr-only">To date</label>
        <input
          id="tx-date-to"
          type="date"
          value={filters.dateTo}
          onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
          aria-label="Filter to date"
        />
        <button type="submit" className="tx-filter-btn">Filter</button>
        <label htmlFor="tx-hash-filter" className="sr-only">Transaction hash</label>
        <input
          id="tx-hash-filter"
          type="text"
          placeholder="Search by hash…"
          value={filters.hash}
          onChange={e => setFilters(f => ({ ...f, hash: e.target.value }))}
          aria-label="Filter by transaction hash"
          spellCheck={false}
        />
      </form>

      <AnimatePresence mode="wait">
        {error && (
          <motion.div key="error" className="tx-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <p>{error}</p>
            <button className="tx-page-btn" onClick={() => fetchPage(cursors[cursors.length - 1] ?? null)}>↺ Retry</button>
          </motion.div>
        )}
        {!error && loaded && (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {txs.length === 0 ? (
              <p className="tx-empty" role="status">No transactions found.</p>
            ) : (
              <>
                <div className="tx-list" role="list" aria-label="Transactions">
                  {txs.map(tx => <TxRow key={tx.id} tx={tx} onClick={setSelected} onRetry={retrying[tx.id] !== 'pending' ? handleRetry : null} />)}
                </div>
                <nav className="tx-pagination" aria-label="Transaction page navigation">
                  <button onClick={handleBack} disabled={cursors.length === 0 || loading} className="tx-page-btn" aria-label="Previous page">← Prev</button>
                  <button onClick={handleNext} disabled={!nextCursor || loading} className="tx-page-btn" aria-label="Next page">Next →</button>
                </nav>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selected && <TxModal tx={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </section>
  );
}
