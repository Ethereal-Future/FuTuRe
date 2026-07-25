import { useState, useRef, useEffect, useId } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * SearchableSelect — searchable dropdown for asset/option selection.
 * Props: value, onChange, options ([{ value, label, description? }]), placeholder, aria-label
 */
export function SearchableSelect({ value, onChange, options = [], placeholder = 'Select…', 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledby }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef(null);
  const inputRef = useRef(null);
  const listboxId = useId();
  const getOptionId = (index) => `${listboxId}-option-${index}`;

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

  // Reset active index when dropdown opens or query changes
  useEffect(() => {
    setActiveIndex(filtered.length > 0 ? 0 : -1);
  }, [open, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (opt) => {
    onChange?.(opt.value);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const openDropdown = () => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDropdown();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex(i => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (activeIndex <= 0) {
          setOpen(false);
          inputRef.current?.blur();
        } else {
          setActiveIndex(i => i - 1);
        }
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(filtered.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && filtered[activeIndex]) {
          pick(filtered[activeIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        setQuery('');
        break;
      case 'Tab':
        setOpen(false);
        setQuery('');
        break;
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={openDropdown}
        onKeyDown={handleKeyDown}
        style={triggerStyle}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? getOptionId(activeIndex) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-autocomplete="list"
      >
        <span style={{ flex: 1, textAlign: 'left', color: selected ? '#333' : '#999' }}>
          {selected ? selected.label : placeholder}
        </span>
        <span style={{ color: '#888', fontSize: 12 }} aria-hidden="true">{open ? '▲' : '▼'}</span>
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
              <label htmlFor={`${listboxId}-search`} className="sr-only">Search options</label>
              <input
                ref={inputRef}
                id={`${listboxId}-search`}
                value={query}
                onChange={e => { setQuery(e.target.value); setActiveIndex(0); }}
                onKeyDown={handleKeyDown}
                placeholder="Search…"
                aria-label="Search options"
                aria-controls={listboxId}
                aria-autocomplete="list"
                style={{ margin: 0, fontSize: 13, minHeight: 'unset', padding: '6px 8px' }}
              />
            </div>
            <ul
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel || placeholder}
              style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 180, overflowY: 'auto' }}
            >
              {filtered.length === 0 && (
                <li role="option" aria-selected={false} aria-disabled="true" style={{ padding: '10px 12px', fontSize: 13, color: '#888' }}>No results</li>
              )}
              {filtered.map((opt, index) => (
                <li
                  key={opt.value}
                  id={getOptionId(index)}
                  role="option"
                  aria-selected={opt.value === value}
                  onMouseDown={() => pick(opt)}
                  onMouseEnter={() => setActiveIndex(index)}
                  style={{
                    ...itemStyle,
                    background: index === activeIndex ? '#dbeafe' : opt.value === value ? '#e8f0fe' : 'white',
                    outline: index === activeIndex ? '2px solid #2563eb' : 'none',
                    outlineOffset: -2,
                  }}
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
