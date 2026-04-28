import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const STORAGE_KEY = 'stellar_address_book';

function loadContacts() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? []; } catch { return []; }
}

function saveContacts(contacts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
}

/**
 * AddressBook — manage saved recipients and select one.
 * Props: onSelect, prefillAddress (string to pre-populate the new-contact address field)
 */
export function AddressBook({ onSelect, prefillAddress = '' }) {
  const [contacts, setContacts] = useState(loadContacts);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState(prefillAddress);
  const [search, setSearch] = useState('');

  // Sync prefillAddress into the new-contact form when it changes
  useEffect(() => { if (prefillAddress) setNewAddress(prefillAddress); }, [prefillAddress]);

  const filtered = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.address.toLowerCase().includes(search.toLowerCase())
  );

  const add = () => {
    if (!newName.trim() || !newAddress.trim()) return;
    const updated = [...contacts, { name: newName.trim(), address: newAddress.trim() }];
    setContacts(updated);
    saveContacts(updated);
    setNewName('');
    setNewAddress('');
  };

  const remove = (address) => {
    const updated = contacts.filter(c => c.address !== address);
    setContacts(updated);
    saveContacts(updated);
  };

  return (
    <div>
      <button type="button" onClick={() => setOpen(o => !o)} style={{ marginBottom: 8 }}>
        📒 Address Book {contacts.length > 0 && `(${contacts.length})`}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={panelStyle}>
              <input
                placeholder="Search contacts…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ marginBottom: 8 }}
              />
              {filtered.length === 0 && (
                <p style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>No contacts found.</p>
              )}
              {filtered.map(c => (
                <div key={c.address} style={rowStyle}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.address}
                    </div>
                  </div>
                  <button type="button" onClick={() => { onSelect?.(c.address); setOpen(false); }} style={smBtn}>
                    Use
                  </button>
                  <button type="button" onClick={() => remove(c.address)} style={{ ...smBtn, background: '#ef4444' }}>
                    ✕
                  </button>
                </div>
              ))}
              <div style={{ borderTop: '1px solid #eee', paddingTop: 8, marginTop: 8 }}>
                <input placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} style={{ marginBottom: 6 }} />
                <input placeholder="Stellar Address" value={newAddress} onChange={e => setNewAddress(e.target.value)} style={{ marginBottom: 6 }} />
                <button type="button" onClick={add}>+ Add Contact</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const panelStyle = { border: '1px solid #ddd', borderRadius: 4, padding: 12, background: '#fafafa', marginBottom: 8 };
const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 };
const smBtn = { background: '#0066cc', color: 'white', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer', width: 'auto', minHeight: 'unset', minWidth: 'unset' };
