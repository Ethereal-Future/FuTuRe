import { useState, useEffect } from 'react';
import axios from 'axios';

/**
 * Fetches the XLM/USD exchange rate on mount and keeps it fresh via
 * rateChange WebSocket events (passed in as `wsMessage`).
 *
 * @param {object|null} wsMessage – latest message from useWebSocket's onMessage
 * @returns {{ rate: number|null, loading: boolean }}
 */
export function useExchangeRate(wsMessage) {
  const [rate, setRate] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/api/stellar/exchange-rate/XLM/USD')
      .then(({ data }) => setRate(data.rate))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (wsMessage?.type === 'rateChange' && wsMessage.from === 'XLM' && wsMessage.to === 'USD') {
      setRate(wsMessage.rate);
    }
  }, [wsMessage]);

  return { rate, loading };
}
