import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * AutoComplete — text input with filtered dropdown suggestions.
 * Props: value, onChange, suggestions (string[]), placeholder, onSelect
 */
export function AutoComplete({ value, onChange, suggestions = [], placeholder, onSelect }) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const ref = useRef(null);

  const filtered = value
    ? suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()))
    : suggestions;

  useEffect(() => {
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const pick = (item) => {
    onSelect?.(item);
    onChange?.(item);
    setOpen(false);
    setActiveIdx(-1);
  };

  const onKeyDown = (e) => {
    if (!open || !filtered.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && activeIdx >= 0) pick(filtered[activeIdx]);
    if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        value={value}
        onChange={e => { onChange?.(e.target.value); setOpen(true); setActiveIdx(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open && filtered.length > 0}
      />
      <AnimatePresence>
        {open && filtered.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            style={dropdownStyle}
            role="listbox"
          >
            {filtered.map((item, i) => (
              <li
                key={item}
                role="option"
                aria-selected={i === activeIdx}
                onMouseDown={() => pick(item)}
                style={{ ...itemStyle, background: i === activeIdx ? '#e8f0fe' : 'white' }}
              >
                {item}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

const dropdownStyle = {
  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
  background: 'white', border: '1px solid #ddd', borderRadius: 4,
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)', listStyle: 'none',
  maxHeight: 200, overflowY: 'auto', margin: 0, padding: 0,
};
const itemStyle = {
  padding: '8px 12px', cursor: 'pointer', fontSize: 14,
};
