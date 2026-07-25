import apiClient from './client.js';

/**
 * Fetch the current KYC status for the authenticated user.
 */
export async function getKycStatus() {
  const response = await apiClient.get('/api/compliance/kyc/status');
  return response.data.status;
}

/**
 * Submit a new KYC request payload.
 */
export async function submitKyc(payload) {
  const response = await apiClient.post('/api/compliance/kyc', payload);
  return response.data;
}

/**
 * Fetch AML alerts with paging.
 */
export async function getAmlAlerts(page = 1, limit = 20) {
  const response = await apiClient.get(`/api/compliance/aml/alerts?page=${page}&limit=${limit}`);
  return response.data;
}

/**
 * Mark an AML alert as reviewed.
 */
export async function reviewAmlAlert(alertId, reviewPayload) {
  const response = await apiClient.patch(`/api/compliance/aml/alerts/${alertId}/review`, reviewPayload);
  return response.data;
}
