/**
 * useAccountSettings — loads per-account preferences (fiat currency,
 * biometric re-auth threshold) and the user's role from the JWT token.
 *
 * Fixes #1418: removes fiatCurrency, biometricThreshold, and userRole
 * from App.jsx's flat state bag.  These values only trigger re-renders in
 * the (small) components that actually use them.
 *
 * @param {string|null} publicKey  Active account public key.
 */
import { useState, useEffect } from 'react';
import apiClient from '../api/client.js';

/** XLM amount above which biometric re-auth is required (server-overridable). */
const DEFAULT_BIOMETRIC_REAUTH_THRESHOLD = 100;

/**
 * @param {{ publicKey: string|null }} opts
 * @returns {{
 *   fiatCurrency: string,
 *   biometricThreshold: number,
 *   userRole: string|null,
 * }}
 */
export function useAccountSettings({ publicKey }) {
  const [fiatCurrency, setFiatCurrency] = useState('USD');
  const [biometricThreshold, setBiometricThreshold] = useState(
    DEFAULT_BIOMETRIC_REAUTH_THRESHOLD,
  );
  const [userRole, setUserRole] = useState(null);

  // Load fiat currency + biometric threshold from account settings API.
  useEffect(() => {
    if (!publicKey) return;

    const STELLAR_ASSETS = new Set(['XLM', 'USDC', 'EURC']);

    apiClient
      .get(`/api/stellar/account/${publicKey}/settings`)
      .then(({ data }) => {
        const asset = data?.defaultAsset;
        if (asset && !STELLAR_ASSETS.has(asset)) {
          setFiatCurrency(asset);
        } else if (asset === 'EURC') {
          setFiatCurrency('EUR');
        }
        if (typeof data?.biometricReauthThreshold === 'number') {
          setBiometricThreshold(data.biometricReauthThreshold);
        }
      })
      .catch(() => {
        /* use defaults */
      });
  }, [publicKey]);

  // Read role from the JWT stored in localStorage (best-effort, no fetch).
  useEffect(() => {
    const token = localStorage.getItem('authToken');
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setUserRole(payload.role ?? null);
    } catch {
      // Invalid token format — leave userRole as null.
    }
  }, []);

  return { fiatCurrency, biometricThreshold, userRole };
}
