import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { getContacts, createContact, deleteContact } from '../api/stellar.js';

/**
 * AddressBook — manage saved recipients synced with the backend.
 * Falls back to localStorage when the user is not authenticated.
 * Props: onSelect, prefillAddress
 */
export function AddressBook({ onSelect, prefillAddress = '' }) {
  const { t } = useTranslation();
  const [contacts, setContacts] = useState([]);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState(prefillAddress);
  const [search, setSearch] = useState('');
  const [synced, setSynced] = useState(false);

  useEffect(() => { if (prefillAddress) setNewAddress(prefillAddress); }, [prefillAddress]);

  // Load from backend on open; fall back to localStorage
  useEffect(() => {
    if (!open || synced) return;
    getContacts()
      .then((data) => { setContacts(data); setSynced(true); })
      .catch(() => {
        // not authenticated – load from localStorage
        try { setContacts(JSON.parse(localStorage.getItem('stellar_address_book')) ?? []); } catch { /* */ }
        setSynced(true);
      });
  }, [open, synced]);

  const filtered = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.address.toLowerCase().includes(search.toLowerCase())
  );

  const add = useCallback(async () => {
    if (!newName.trim() || !newAddress.trim()) return;
    try {
      const contact = await createContact({ name: newName.trim(), address: newAddress.trim() });
      setContacts(prev => [...prev, contact]);
    } catch {
      // fallback: local only
      const entry = { id: Date.now().toString(), name: newName.trim(), address: newAddress.trim() };
      setContacts(prev => [...prev, entry]);
    }
    setNewName('');
    setNewAddress('');
  }, [newName, newAddress]);

  const remove = useCallback(async (contact) => {
    setContacts(prev => prev.filter(c => c.address !== contact.address));
    if (contact.id) {
      try { await deleteContact(contact.id); } catch { /* best-effort */ }
    }
  }, []);

  return (
    <div>
      <button type="button" onClick={() => setOpen(o => !o)} style={{ marginBottom: 8 }}>
        {t('addressBook.title')} {contacts.length > 0 && `(${contacts.length})`}
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
              <label htmlFor="addr-book-search" className="sr-only">{t('addressBook.searchAriaLabel')}</label>
              <input
                id="addr-book-search"
                aria-label={t('addressBook.searchAriaLabel')}
                placeholder={t('addressBook.searchPlaceholder')}
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ marginBottom: 8 }}
              />
              {filtered.length === 0 && (
                <p style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>{t('addressBook.empty')}</p>
              )}
              {filtered.map(c => (
                <div key={c.id ?? c.address} style={rowStyle}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.address}
                    </div>
                  </div>
                  <button type="button" onClick={() => { onSelect?.(c.address); setOpen(false); }} style={smBtn}>
                    {t('addressBook.use')}
                  </button>
                  <button type="button" onClick={() => remove(c)} style={{ ...smBtn, background: '#ef4444' }} aria-label={t('addressBook.removeContact', { name: c.name })}>
                    ✕
                  </button>
                </div>
              ))}
              <div style={{ borderTop: '1px solid #eee', paddingTop: 8, marginTop: 8 }}>
                <label htmlFor="addr-book-new-name" className="sr-only">{t('addressBook.namePlaceholder')}</label>
                <input id="addr-book-new-name" aria-label={t('addressBook.namePlaceholder')} placeholder={t('addressBook.nameLabel')} value={newName} onChange={e => setNewName(e.target.value)} style={{ marginBottom: 6 }} />
                <label htmlFor="addr-book-new-address" className="sr-only">{t('addressBook.addressPlaceholder')}</label>
                <input id="addr-book-new-address" aria-label={t('addressBook.addressPlaceholder')} placeholder={t('addressBook.addressLabel')} value={newAddress} onChange={e => setNewAddress(e.target.value)} style={{ marginBottom: 6 }} />
                <button type="button" onClick={add}>{t('addressBook.addContact')}</button>
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
