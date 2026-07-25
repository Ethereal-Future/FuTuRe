import { useEffect, useState } from 'react';
import { getNetworkStatus } from '../api/stellar.js';

export function useNetworkStatus(intervalMs = 30000) {
  const [status, setStatus] = useState(null);

  const check = async () => {
    try {
      const data = await getNetworkStatus();
      setStatus(data);
    } catch {
      setStatus((prev) => prev ? { ...prev, online: false } : { online: false });
    }
  };

  useEffect(() => {
    check();
    const id = setInterval(check, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return { status, refresh: check };
}
