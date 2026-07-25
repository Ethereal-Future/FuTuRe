import { useState, useCallback } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { Spinner } from './Spinner';
import { SlideOver } from './SlideOver';
import { TransactionDetailPanel } from './TransactionDetailPanel';

const TYPE_LABELS = { payment: 'Payment', create_account: 'Account Created', unknown: 'Other' };
const PAGE_SIZE = 10;

function fmt(dateStr) {
  return new Date(dateStr).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function TxRow({ tx, onClick }) {
  const isReceived = tx.direction === 'received';
  const isSent = tx.direction === 'sent';
  return (
    <motion.div
      className="tx-row"
      onClick={() => onClick(tx)}
      whileTap={{ scale: 0.98 }}
      layout
    >
      <span className={`tx-dir ${isReceived ? 'tx-in' : isSent ? 'tx-out' : 'tx-neutral'}`}>
        {isReceived ? '↓' : isSent ? '↑' : '•'}
      </span>
      <span className="tx-type">{TYPE_LABELS[tx.type] ?? tx.type}</span>
      <span className="tx-amount">
        {tx.amount ? `${tx.amount} ${tx.asset ?? ''}` : '—'}
      </span>
      <span className="tx-date">{fmt(tx.date)}</span>
      <span className={`tx-status ${tx.successful ? 'tx-ok' : 'tx-fail'}`}>
        {tx.successful ? '✓' : '✗'}
      </span>
    </motion.div>
  );
}

export function TransactionHistory({ publicKey, network = 'public' }) {
  const [txs, setTxs] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ type: '', dateFrom: '', dateTo: '' });
  const [cursors, setCursors] = useState([]); // stack for back-pagination

  const fetchPage = useCallback(async (cursor = null, isBack = false) => {
    setLoading(true);
    try {
      const params = { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) };
      if (filters.type) params.type = filters.type;
      if (filters.dateFrom) params.dateFrom = filters.dateFrom;
      if (filters.dateTo) params.dateTo = filters.dateTo;

      const { data } = await axios.get(`/api/stellar/account/${publicKey}/transactions`, { params });
      setTxs(data.records);
      setNextCursor(data.nextCursor);
      setLoaded(true);

      if (!isBack && cursor) {
        setCursors(prev => [...prev, cursor]);
      }
    } catch (e) {
      // errors handled by parent via StatusMessage
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

  const applyFilters = (e) => {
    e.preventDefault();
    setCursors([]);
    fetchPage(null);
  };

  return (
    <div className="section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3>Transaction History</h3>
        <motion.button className="tx-load-btn" onClick={handleLoad} disabled={loading} whileTap={{ scale: 0.97 }}>
          {loading ? <Spinner /> : loaded ? '↺ Refresh' : 'Load History'}
        </motion.button>
      </div>

      {/* Filters */}
      <form className="tx-filters" onSubmit={applyFilters}>
        <select value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}>
          <option value="">All types</option>
          <option value="payment">Payment</option>
          <option value="create_account">Account Created</option>
        </select>
        <input type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} placeholder="From" />
        <input type="date" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} placeholder="To" />
        <button type="submit" className="tx-filter-btn">Filter</button>
      </form>

      <AnimatePresence mode="wait">
        {loaded && (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {txs.length === 0 ? (
              <p className="tx-empty">No transactions found.</p>
            ) : (
              <>
                <div className="tx-list">
                  {txs.map(tx => <TxRow key={tx.id} tx={tx} onClick={setSelected} />)}
                </div>
                <div className="tx-pagination">
                  <button onClick={handleBack} disabled={cursors.length === 0 || loading} className="tx-page-btn">← Prev</button>
                  <button onClick={handleNext} disabled={!nextCursor || loading} className="tx-page-btn">Next →</button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <SlideOver open={!!selected} onClose={() => setSelected(null)} title="Transaction Details">
        <TransactionDetailPanel tx={selected} network={network} />
      </SlideOver>
    </div>
  );
}
