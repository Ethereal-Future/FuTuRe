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

/**
 * Requests a server-issued WebAuthn challenge for the given public key.
 * The challenge must be generated and tracked server-side to prevent replay.
 */
export async function getWebAuthnChallenge(publicKey, options = {}) {
  const response = await apiClient.get('/api/auth/webauthn/challenge', {
    ...options,
    params: { ...(options.params || {}), publicKey },
  });
  return response.data;
}

/**
 * Submits an authenticator assertion to the server for verification.
 * The server validates the signature against the stored challenge and rejects
 * replayed or mocked assertions.
 */
export async function verifyWebAuthnAssertion(payload, options = {}) {
  const { credentialId, authenticatorData, clientDataJSON, signature, challengeId } = payload || {};
  const response = await apiClient.post(
    '/api/auth/webauthn/verify',
    { credentialId, authenticatorData, clientDataJSON, signature, challengeId },
    options
  );
  return response.data;
}
