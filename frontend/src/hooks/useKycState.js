/**
 * useKycState — manages KYC status fetching and caching.
 *
 * Fixes #1418: removes kycStatus / kycLoading / kycError from App.jsx's
 * flat state bag.  KYC state changes only re-render the sections that
 * actually consume these values.
 *
 * @param {string|null} publicKey  Active account public key (used to reset
 *                                 cached status when the account changes).
 */
import { useState, useCallback, useEffect } from 'react';
import { getKycStatus } from '../api/compliance.js';

/**
 * @param {{ publicKey: string|null }} opts
 * @returns {{
 *   kycStatus: string|null,
 *   kycLoading: boolean,
 *   kycError: string|null,
 *   fetchKycStatus: () => Promise<void>,
 * }}
 */
export function useKycState({ publicKey }) {
  const [kycStatus, setKycStatus] = useState(null);
  const [kycLoading, setKycLoading] = useState(false);
  const [kycError, setKycError] = useState(null);

  const fetchKycStatus = useCallback(async () => {
    if (!publicKey) {
      setKycStatus(null);
      return;
    }

    setKycLoading(true);
    try {
      const status = await getKycStatus();
      setKycStatus(status);
      setKycError(null);
    } catch (error) {
      if (error.response?.status === 404) {
        setKycStatus(null);
      } else {
        setKycError(error.response?.data?.error || 'Failed to load KYC status');
        setKycStatus(null);
      }
    } finally {
      setKycLoading(false);
    }
  }, [publicKey]);

  // Refetch whenever the active account changes.
  useEffect(() => {
    fetchKycStatus();
  }, [fetchKycStatus]);

  return { kycStatus, kycLoading, kycError, fetchKycStatus };
}
