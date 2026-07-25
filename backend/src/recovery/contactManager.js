import crypto from 'crypto';

// In-memory store for recovery contacts (replace with DB in production)
const recoveryContacts = new Map(); // userId -> [{ id, email, name, confirmedAt }]

export function addContact(userId, email, name) {
  const contacts = recoveryContacts.get(userId) || [];
  if (contacts.length >= 5) throw new Error('Maximum 5 recovery contacts allowed');
  if (contacts.some(c => c.email === email)) throw new Error('Contact already exists');

  const contact = {
    id: crypto.randomUUID(),
    email,
    name,
    confirmedAt: null,
    addedAt: new Date().toISOString(),
  };
  contacts.push(contact);
  recoveryContacts.set(userId, contacts);
  return contact;
}

export function confirmContact(userId, contactId) {
  const contacts = recoveryContacts.get(userId) || [];
  const contact = contacts.find(c => c.id === contactId);
  if (!contact) throw new Error('Contact not found');
  contact.confirmedAt = new Date().toISOString();
  return contact;
}

export function removeContact(userId, contactId) {
  const contacts = recoveryContacts.get(userId) || [];
  const filtered = contacts.filter(c => c.id !== contactId);
  if (filtered.length === contacts.length) throw new Error('Contact not found');
  recoveryContacts.set(userId, filtered);
}

export function getContacts(userId) {
  return recoveryContacts.get(userId) || [];
}

export function getConfirmedContactCount(userId) {
  return getContacts(userId).filter(c => c.confirmedAt).length;
}
