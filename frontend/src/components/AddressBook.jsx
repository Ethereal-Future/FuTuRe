import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import apiClient from '../api/client.js';
import { getContacts, createContact, deleteContact } from '../api/stellar.js';
import {
  getStellarAddressError,
  isFederationAddress,
  findInvalidAddressChars,
} from '../utils/validateStellarAddress';
import { useMessages } from '../hooks/useMessages';

/**
 * AddressBook — manage saved recipients synced with the backend.
 * Falls back to localStorage when the user is not authenticated.
 * Props: onSelect, prefillAddress
 */
export function AddressBook({ onSelect, prefillAddress = '' }) {
  const { t } = useTranslation();
  const msg = useMessages();
  const [contacts, setContacts] = useState([]);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState(prefillAddress);
  const [newAddressTouched, setNewAddressTouched] = useState(false);
  const [search, setSearch] = useState('');
  const [synced, setSynced] = useState(false);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState(null);

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

  const trimmedAddress = newAddress.trim();
  const newAddressError = getStellarAddressError(newAddress);
  const newAddressValid = newAddressError === null;
  const showAddressError = newAddressTouched && trimmedAddress && !newAddressValid;
  const invalidCharIdx = showAddressError && newAddressError === 'invalidChars'
    ? new Set(findInvalidAddressChars(trimmedAddress))
    : null;

  const add = useCallback(async () => {
    if (!newName.trim() || !trimmedAddress) return;
    if (!newAddressValid) return;
    setResolveError(null);

    // Federation addresses are resolved to a checksummed G... key before saving,
    // so the stored contact always points at a concrete account.
    let address = trimmedAddress;
    if (isFederationAddress(trimmedAddress)) {
      setResolving(true);
      try {
        const { data } = await apiClient.get('/api/stellar/federation', { params: { address: trimmedAddress } });
        if (getStellarAddressError(data?.account_id ?? '') !== null) throw new Error('bad account_id');
        address = data.account_id;
      } catch {
        setResolveError(t('addressBook.errors.federationUnresolved', { address: trimmedAddress }));
        return;
      } finally {
        setResolving(false);
      }
    }

    try {
      const contact = await createContact({ name: newName.trim(), address });
      setContacts(prev => [...prev, contact]);
    } catch {
      // fallback: local only
      const entry = { id: Date.now().toString(), name: newName.trim(), address };
      setContacts(prev => [...prev, entry]);
    }
    setNewName('');
    setNewAddress('');
    setNewAddressTouched(false);
  }, [newName, trimmedAddress, newAddressValid, t]);

  const addDisabled = !newName.trim() || !trimmedAddress || !newAddressValid || resolving;

  const remove = useCallback(async (contact) => {
    setContacts(prev => prev.filter(c => c.address !== contact.address));
    if (contact.id) {
      try { 
        await deleteContact(contact.id); 
      } catch (error) {
        // Rollback on failure
        setContacts(prev => [...prev, contact]);
        msg.error(t('addressBook.removeFailed'));
      }
    }
  }, [msg, t]);

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
                  {confirmingRemoveId === (c.id ?? c.address) ? (
                    <>
                      <button 
                        type="button" 
                        onClick={() => { remove(c); setConfirmingRemoveId(null); }} 
                        style={{ ...smBtn, background: '#ef4444' }}
                        aria-label={t('addressBook.confirmRemove')}
                      >
                        {t('addressBook.confirmRemove')}
                      </button>
                      <button 
                        type="button" 
                        onClick={() => setConfirmingRemoveId(null)} 
                        style={{ ...smBtn, background: '#6b7280' }}
                        aria-label={t('addressBook.cancelRemove')}
                      >
                        {t('addressBook.cancelRemove')}
                      </button>
                    </>
                  ) : (
                    <button 
                      type="button" 
                      onClick={() => setConfirmingRemoveId(c.id ?? c.address)} 
                      style={{ ...smBtn, background: '#ef4444' }}
                      aria-label={t('addressBook.removeContact', { name: c.name })}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <div style={{ borderTop: '1px solid #eee', paddingTop: 8, marginTop: 8 }}>
                <label htmlFor="addr-book-new-name" className="sr-only">{t('addressBook.namePlaceholder')}</label>
                <input 
                  id="addr-book-new-name" 
                  aria-label={t('addressBook.namePlaceholder')} 
                  placeholder={t('addressBook.nameLabel')} 
                  value={newName} 
                  onChange={e => setNewName(e.target.value)} 
                  style={{ marginBottom: 6 }} 
                />
                <label htmlFor="addr-book-new-address" className="sr-only">{t('addressBook.addressPlaceholder')}</label>
                <input 
                  id="addr-book-new-address" 
                  aria-label={t('addressBook.addressPlaceholder')} 
                  placeholder={t('addressBook.addressLabel')} 
                  value={newAddress} 
                  onChange={e => { setNewAddress(e.target.value); setNewAddressTouched(true); setResolveError(null); }} 
                  onBlur={() => setNewAddressTouched(true)}
                  style={{ 
                    marginBottom: 6,
                    border: newAddressTouched && trimmedAddress ? (newAddressValid ? '1px solid #22c55e' : '1px solid #ef4444') : '1px solid #ccc'
                  }}
                  aria-invalid={Boolean(showAddressError)}
                  aria-describedby={showAddressError ? 'addr-book-address-error' : 'addr-book-address-status'}
                />
                {invalidCharIdx && (
                  <div aria-hidden="true" data-testid="addr-book-invalid-chars" style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', marginBottom: 4 }}>
                    {[...trimmedAddress].map((ch, i) => (
                      <span key={i} style={invalidCharIdx.has(i) ? { background: '#fecaca', color: '#b91c1c', fontWeight: 700 } : undefined}>{ch}</span>
                    ))}
                  </div>
                )}
                {showAddressError && (
                  <p id="addr-book-address-error" role="alert" style={{ color: '#ef4444', fontSize: 12, marginBottom: 6, marginTop: -2 }}>
                    {t(`addressBook.errors.${newAddressError}`, { length: trimmedAddress.length })}
                  </p>
                )}
                {newAddressTouched && trimmedAddress && newAddressValid && (
                  <p id="addr-book-address-status" style={{ color: '#16a34a', fontSize: 12, marginBottom: 6, marginTop: -2 }}>
                    {isFederationAddress(trimmedAddress) ? t('addressBook.federationValid') : t('addressBook.checksumValid')}
                  </p>
                )}
                {resolveError && (
                  <p role="alert" style={{ color: '#ef4444', fontSize: 12, marginBottom: 6, marginTop: -2 }}>
                    {resolveError}
                  </p>
                )}
                <button 
                  type="button" 
                  onClick={add}
                  disabled={addDisabled}
                  style={{ opacity: addDisabled ? 0.5 : 1, cursor: addDisabled ? 'not-allowed' : 'pointer' }}
                >
                  {resolving ? t('addressBook.resolving') : t('addressBook.addContact')}
                </button>
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
