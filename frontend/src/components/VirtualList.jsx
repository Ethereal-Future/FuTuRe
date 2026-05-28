import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

// ─── Shared ───────────────────────────────────────────────────────────────────

/** LRU item cache — keeps the last `max` rendered row nodes */
function useItemCache(max = 200) {
  const cache = useRef(new Map());
  const get = useCallback((key, build) => {
    if (cache.current.has(key)) return cache.current.get(key);
    const val = build();
    if (cache.current.size >= max) {
      cache.current.delete(cache.current.keys().next().value);
    }
    cache.current.set(key, val);
    return val;
  }, [max]);
  const invalidate = useCallback((key) => cache.current.delete(key), []);
  const clear = useCallback(() => cache.current.clear(), []);
  return { get, invalidate, clear };
}

/** Simple perf monitor — tracks render count and last render duration */
function useListPerf(label = 'VirtualList') {
  const renders = useRef(0);
  const lastMs = useRef(0);
  const t = useRef(0);
  useEffect(() => {
    t.current = performance.now();
    return () => { lastMs.current = performance.now() - t.current; };
  });
  renders.current += 1;
  return { renders: renders.current, lastMs: lastMs.current, label };
}

// ─── 1. VirtualList — core windowed list ─────────────────────────────────────

/**
 * VirtualList — renders only visible rows using @tanstack/react-virtual.
 *
 * Props:
 *   items        – full array of data
 *   renderItem   – (item, index) => JSX
 *   itemHeight   – estimated row height in px (default 64)
 *   height       – container height in px (default 480)
 *   overscan     – extra rows to render outside viewport (default 5)
 *   emptyState   – JSX shown when items is empty
 *   showPerf     – show perf overlay (dev only)
 */
export function VirtualList({
  items = [],
  renderItem,
  itemHeight = 64,
  height = 480,
  overscan = 5,
  emptyState,
  showPerf = false,
}) {
  const parentRef = useRef(null);
  const perf = useListPerf('VirtualList');

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan,
  });

  if (items.length === 0) {
    return emptyState ?? <div style={emptyStyle}>No items to display.</div>;
  }

  return (
    <div style={{ position: 'relative' }}>
      <div ref={parentRef} style={{ height, overflowY: 'auto', ...scrollStyle }}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map(vRow => (
            <div
              key={vRow.key}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vRow.start}px)`,
              }}
            >
              {renderItem(items[vRow.index], vRow.index)}
            </div>
          ))}
        </div>
      </div>
      {showPerf && (
        <div style={perfOverlayStyle}>
          renders: {perf.renders} | last: {perf.lastMs.toFixed(1)}ms | visible: {virtualizer.getVirtualItems().length}/{items.length}
        </div>
      )}
    </div>
  );
}

// ─── 2. SearchableVirtualList — VirtualList + search ─────────────────────────

/**
 * SearchableVirtualList — adds a search bar that filters before virtualizing.
 *
 * Props: same as VirtualList, plus:
 *   searchKeys  – array of item property names to search (default ['id'])
 *   placeholder – search input placeholder
 */
export function SearchableVirtualList({
  items = [],
  searchKeys = ['id'],
  placeholder = 'Search…',
  ...rest
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(item =>
      searchKeys.some(k => String(item[k] ?? '').toLowerCase().includes(q))
    );
  }, [items, query, searchKeys]);

  return (
    <div>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={placeholder}
        style={{ marginBottom: 8 }}
        aria-label="Search list"
      />
      {query && (
        <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>
          {filtered.length} of {items.length} results
        </div>
      )}
      <VirtualList items={filtered} {...rest} />
    </div>
  );
}

// ─── 3. InfiniteVirtualList — VirtualList + infinite scroll ──────────────────

/**
 * InfiniteVirtualList — loads more items when the user scrolls near the bottom.
 *
 * Props: same as VirtualList, plus:
 *   hasMore      – boolean, whether more pages exist
 *   onLoadMore   – async () => void, called to fetch next page
 *   loadingRow   – JSX shown as the last row while loading
 */
export function InfiniteVirtualList({
  items = [],
  hasMore = false,
  onLoadMore,
  loadingRow,
  itemHeight = 64,
  height = 480,
  overscan = 5,
  renderItem,
  emptyState,
  showPerf = false,
}) {
  const [loading, setLoading] = useState(false);
  const parentRef = useRef(null);
  const perf = useListPerf('InfiniteVirtualList');

  const count = items.length + (hasMore ? 1 : 0); // +1 sentinel row

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan,
  });

  // Trigger load when sentinel row becomes visible
  useEffect(() => {
    const vItems = virtualizer.getVirtualItems();
    if (!vItems.length) return;
    const last = vItems[vItems.length - 1];
    if (last.index >= items.length && hasMore && !loading) {
      setLoading(true);
      Promise.resolve(onLoadMore?.()).finally(() => setLoading(false));
    }
  }, [virtualizer.getVirtualItems(), hasMore, loading, items.length, onLoadMore]);

  if (items.length === 0 && !hasMore) {
    return emptyState ?? <div style={emptyStyle}>No items to display.</div>;
  }

  return (
    <div style={{ position: 'relative' }}>
      <div ref={parentRef} style={{ height, overflowY: 'auto', ...scrollStyle }}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map(vRow => (
            <div
              key={vRow.key}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute', top: 0, left: 0, width: '100%',
                transform: `translateY(${vRow.start}px)`,
              }}
            >
              {vRow.index < items.length
                ? renderItem(items[vRow.index], vRow.index)
                : (loadingRow ?? <div style={sentinelStyle}>Loading more…</div>)
              }
            </div>
          ))}
        </div>
      </div>
      {showPerf && (
        <div style={perfOverlayStyle}>
          renders: {perf.renders} | visible: {virtualizer.getVirtualItems().length}/{count} | {loading ? 'loading…' : 'idle'}
        </div>
      )}
    </div>
  );
}

// ─── 4. TransactionList — ready-to-use list for Stellar transactions ──────────

/**
 * TransactionList — pre-styled virtualized transaction list with search.
 *
 * Props:
 *   transactions – array from Stellar API / ChartsDashboard
 *   hasMore      – boolean
 *   onLoadMore   – async fn
 *   height       – container height (default 480)
 */
export function TransactionList({ transactions = [], hasMore, onLoadMore, height = 480 }) {
  const renderItem = useCallback((tx) => (
    <div style={txRowStyle}>
      <span style={{ fontSize: 18 }}>{tx.type === 'received' ? '📥' : '📤'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tx.hash ?? tx.id}
        </div>
        <div style={{ fontSize: 11, color: '#888' }}>{tx.createdAt?.slice(0, 10)}</div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontWeight: 700, color: tx.type === 'received' ? '#22c55e' : '#ef4444', fontSize: 14 }}>
          {tx.type === 'received' ? '+' : '-'}{tx.amount} {tx.asset ?? 'XLM'}
        </div>
        <div style={{ fontSize: 11, color: tx.successful === false ? '#ef4444' : '#22c55e' }}>
          {tx.successful === false ? 'failed' : 'success'}
        </div>
      </div>
    </div>
  ), []);

  return (
    <SearchableVirtualList
      items={transactions}
      searchKeys={['hash', 'id', 'amount', 'asset']}
      placeholder="Search transactions…"
      renderItem={renderItem}
      itemHeight={68}
      height={height}
      hasMore={hasMore}
      onLoadMore={onLoadMore}
      emptyState={<div style={emptyStyle}>No transactions yet.</div>}
    />
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const scrollStyle = { border: '1px solid #e5e7eb', borderRadius: 6 };
const emptyStyle = { padding: 24, textAlign: 'center', color: '#888', fontSize: 14 };
const sentinelStyle = { padding: 12, textAlign: 'center', color: '#888', fontSize: 13 };
const perfOverlayStyle = {
  position: 'absolute', bottom: 4, right: 6, fontSize: 10,
  color: '#888', background: 'rgba(255,255,255,0.85)', padding: '2px 6px', borderRadius: 4,
  pointerEvents: 'none',
};
const txRowStyle = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '10px 14px', borderBottom: '1px solid #f0f0f0',
  background: 'white',
};
