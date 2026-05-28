import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * SearchableSelect — searchable dropdown for asset/option selection.
 * Props: value, onChange, options ([{ value, label, description? }]), placeholder
 */
export function SearchableSelect({ value, onChange, options = [], placeholder = 'Select…' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);
  const inputRef = useRef(null);

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(query.toLowerCase()) ||
    o.value.toLowerCase().includes(query.toLowerCase())
  );

  const selected = options.find(o => o.value === value);

  useEffect(() => {
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const pick = (opt) => {
    onChange?.(opt.value);
    setOpen(false);
    setQuery('');
  };

  const openDropdown = () => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={openDropdown}
        style={triggerStyle}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span style={{ flex: 1, textAlign: 'left', color: selected ? '#333' : '#999' }}>
          {selected ? selected.label : placeholder}
        </span>
        <span style={{ color: '#888', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            style={dropdownStyle}
          >
            <div style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search…"
                style={{ margin: 0, fontSize: 13, minHeight: 'unset', padding: '6px 8px' }}
              />
            </div>
            <ul role="listbox" style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 180, overflowY: 'auto' }}>
              {filtered.length === 0 && (
                <li style={{ padding: '10px 12px', fontSize: 13, color: '#888' }}>No results</li>
              )}
              {filtered.map(opt => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  onMouseDown={() => pick(opt)}
                  style={{ ...itemStyle, background: opt.value === value ? '#e8f0fe' : 'white' }}
                >
                  <span style={{ fontWeight: 600 }}>{opt.label}</span>
                  {opt.description && <span style={{ fontSize: 12, color: '#888', marginLeft: 6 }}>{opt.description}</span>}
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const triggerStyle = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
  background: 'white', border: '1px solid #ddd', borderRadius: 4,
  padding: '10px 12px', fontSize: 15, cursor: 'pointer', minHeight: 44,
  color: '#333',
};
const dropdownStyle = {
  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
  background: 'white', border: '1px solid #ddd', borderRadius: 4,
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)', marginTop: 2,
};
const itemStyle = {
  padding: '8px 12px', cursor: 'pointer', fontSize: 14,
};
