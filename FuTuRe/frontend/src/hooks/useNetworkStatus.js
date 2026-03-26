import { useEffect, useState } from 'react';
import axios from 'axios';

export function useNetworkStatus(intervalMs = 30000) {
  const [status, setStatus] = useState(null);

  const check = async () => {
    try {
      const { data } = await axios.get('/api/stellar/network/status');
      setStatus(data);
    } catch {
      setStatus((prev) => prev ? { ...prev, online: false } : { online: false });
    }
  };

  useEffect(() => {
    check();
    const id = setInterval(check, intervalMs);
    return () => clearInterval(id);
  }, []);

  return { status, refresh: check };
}
