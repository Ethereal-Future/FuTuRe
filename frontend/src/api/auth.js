import apiClient from './client.js';

/**
 * Refreshes the access token using the refresh token cookie.
 * Returns the updated access token payload.
 */
export async function refreshAccessToken() {
  const response = await apiClient.post('/api/auth/refresh');
  return response.data;
}

/**
 * Logs the user out on the server.
 */
export async function logout() {
  const response = await apiClient.post('/api/auth/logout');
  return response.data;
}

/**
 * Fetches the current authenticated user profile.
 */
export async function getProfile() {
  const response = await apiClient.get('/api/auth/profile');
  return response.data;
}

/**
 * Setup MFA and get recovery codes
 */
export async function setupMFA(totp, secret, options = {}) {
  const response = await apiClient.post('/api/auth/mfa/setup', { totp, secret }, options);
  return response.data;
}

/**
 * Regenerate recovery codes
 */
export async function regenerateRecoveryCodes(options = {}) {
  const response = await apiClient.post('/api/auth/mfa/regenerate', null, options);
  return response.data;
}

/**
 * Verify recovery code for login
 */
export async function verifyRecoveryCode(publicKey, recoveryCode, options = {}) {
  const response = await apiClient.post('/api/auth/mfa/verify-recovery', { publicKey, recoveryCode }, options);
  return response.data;
}

/**
 * Get MFA status
 */
export async function getMFAStatus(options = {}) {
  const response = await apiClient.get('/api/auth/mfa/status', options);
  return response.data;
}
