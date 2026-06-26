import apiClient from './client.js';

/** @typedef {{ publicKey: string, secretKey: string }} AccountPayload */

export async function createAccount(options = {}) {
  const response = await apiClient.post('/api/stellar/account/create', null, options);
  return response.data;
}

export async function importAccount(secretKey, options = {}) {
  const response = await apiClient.post('/api/stellar/account/import', { secretKey }, options);
  return response.data;
}

export async function getAccount(publicKey, options = {}) {
  const response = await apiClient.get(`/api/stellar/account/${publicKey}`, options);
  return response.data;
}

export async function getAccountLabel(publicKey, options = {}) {
  const response = await apiClient.get(`/api/stellar/account/${publicKey}/label`, options);
  return response.data.accountLabel || '';
}

export async function updateAccountLabel(publicKey, accountLabel, options = {}) {
  const response = await apiClient.put(`/api/stellar/account/${publicKey}/label`, { accountLabel }, options);
  return response.data;
}

export async function sendPayment(payload, options = {}) {
  const response = await apiClient.post('/api/stellar/payment/send', payload, options);
  return response.data;
}

export async function getNetworkStatus(options = {}) {
  const response = await apiClient.get('/api/stellar/network/status', options);
  return response.data;
}

export async function getTransactions(publicKey, params = {}, options = {}) {
  const response = await apiClient.get(`/api/stellar/account/${publicKey}/transactions`, { params, ...options });
  return response.data;
}

export async function getExchangeRate(from, to, options = {}) {
  const response = await apiClient.get(`/api/stellar/exchange-rate/${from}/${to}`, options);
  return response.data.rate;
}

export async function getFeeStats(options = {}) {
  const response = await apiClient.get('/api/stellar/fee-stats', options);
  return response.data;
}

export async function getAmmPools(options = {}) {
  const response = await apiClient.get('/api/stellar/amm/pools', options);
  return response.data;
}

export async function getAmmArbitrage(assetA, assetB, options = {}) {
  const response = await apiClient.get(`/api/stellar/amm/arbitrage/${assetA}/${assetB}`, options);
  return response.data;
}

export async function getConvertQuote(from, to, amount, options = {}) {
  const response = await apiClient.get(`/api/stellar/convert/${from}/${to}/${amount}`, options);
  return response.data;
}

export async function getAccountSettings(publicKey, options = {}) {
  const response = await apiClient.get(`/api/stellar/account/${publicKey}/settings`, options);
  return response.data;
}

export async function updateAccountSettings(publicKey, settings, options = {}) {
  const response = await apiClient.put(`/api/stellar/account/${publicKey}/settings`, settings, options);
  return response.data;
}

export async function createWebhook(payload, options = {}) {
  const response = await apiClient.post('/api/webhooks', payload, options);
  return response.data;
}

export async function getWebhooks(params = {}, options = {}) {
  const response = await apiClient.get('/api/webhooks', { params, ...options });
  return response.data;
}

export async function deleteWebhook(id, options = {}) {
  const response = await apiClient.delete(`/api/webhooks/${id}`, options);
  return response.data;
}

export async function getBackupStatus(options = {}) {
  const response = await apiClient.get('/api/backup/status', options);
  return response.data;
}

export async function createBackup(options = {}) {
  const response = await apiClient.post('/api/backup', { tag: 'manual' }, options);
  return response.data;
}

export async function sendNotificationReadAll(options = {}) {
  const response = await apiClient.post('/api/notifications/read-all', null, options);
  return response.data;
}

export async function getNotifications(options = {}) {
  const response = await apiClient.get('/api/notifications', options);
  return response.data;
}

export async function markNotificationRead(notificationId, options = {}) {
  const response = await apiClient.patch(`/api/notifications/${notificationId}/read`, null, options);
  return response.data;
}

export async function subscribePushNotification(payload, options = {}) {
  const response = await apiClient.post('/api/notifications/push/subscribe', payload, options);
  return response.data;
}

export async function getWebhookManagerAccountData(accountId, options = {}) {
  const response = await apiClient.get('/api/webhooks', { params: { accountId }, ...options });
  return response.data;
}

export async function createStreamPayment(payload, options = {}) {
  const response = await apiClient.post('/api/streaming', payload, options);
  return response.data;
}

export async function getStreamPayments(publicKey, options = {}) {
  const response = await apiClient.get('/api/streaming', { params: { senderPublicKey: publicKey }, ...options });
  return response.data;
}

export async function performStreamAction(id, action, options = {}) {
  const response = await apiClient.post(`/api/streaming/${id}/${action}`, null, options);
  return response.data;
}

export async function retryTransaction(txHash, options = {}) {
  const response = await apiClient.post('/api/retry/transaction', { transactionHash: txHash }, options);
  return response.data;
}

export async function getRecoveryStatus(options = {}) {
  const response = await apiClient.get('/api/recovery/phrase/status', options);
  return response.data;
}

export async function getRecoveryContacts(options = {}) {
  const response = await apiClient.get('/api/recovery/contacts', options);
  return response.data;
}

export async function setupRecoveryPhrase(options = {}) {
  const response = await apiClient.post('/api/recovery/phrase/setup', null, options);
  return response.data;
}

export async function saveRecoveryContact(contact, options = {}) {
  const response = await apiClient.post('/api/recovery/contacts', contact, options);
  return response.data;
}

export async function deleteRecoveryContact(id, options = {}) {
  const response = await apiClient.delete(`/api/recovery/contacts/${id}`, options);
  return response.data;
}

export async function initiateRecovery(requestId, payload, options = {}) {
  const response = await apiClient.post(`/api/recovery/${requestId}/verify-phrase`, payload, options);
  return response.data;
}

export async function getMultisigAccount(publicKey, options = {}) {
  const response = await apiClient.get(`/api/multisig/account/${publicKey}`, options);
  return response.data;
}

export async function getPendingMultisigTransactions(publicKey, options = {}) {
  const response = await apiClient.get(`/api/multisig/transaction/pending/${publicKey}`, options);
  return response.data;
}

export async function createMultisigAccount(payload, options = {}) {
  const response = await apiClient.post('/api/multisig/account/create', payload, options);
  return response.data;
}

export async function buildMultisigTransaction(payload, options = {}) {
  const response = await apiClient.post('/api/multisig/transaction/build', payload, options);
  return response.data;
}

export async function signMultisigTransaction(payload, options = {}) {
  const response = await apiClient.post('/api/multisig/transaction/sign', payload, options);
  return response.data;
}

export async function submitMultisigTransaction(payload, options = {}) {
  const response = await apiClient.post('/api/multisig/transaction/submit', payload, options);
  return response.data;
}

export async function createAccountMerge(payload, options = {}) {
  const response = await apiClient.post('/api/stellar/account/merge', payload, options);
  return response.data;
}

export async function getContacts(options = {}) {
  const response = await apiClient.get('/api/accounts/contacts', options);
  return response.data.contacts;
}

export async function createContact(payload, options = {}) {
  const response = await apiClient.post('/api/accounts/contacts', payload, options);
  return response.data.contact;
}

export async function deleteContact(id, options = {}) {
  await apiClient.delete(`/api/accounts/contacts/${id}`, options);
}

export async function createTrustline(sourceSecret, assetCode, options = {}) {
  const response = await apiClient.post('/api/stellar/trustline/create', { sourceSecret, assetCode }, options);
  return response.data;
}

export async function batchPayment(payload, options = {}) {
  const response = await apiClient.post('/api/stellar/batch-payment', payload, options);
  return response.data;
}
