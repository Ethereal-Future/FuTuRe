import { useState, useEffect } from 'react';
import axios from 'axios';

/**
 * Fetches the XLM/USD exchange rate on mount and keeps it fresh via
 * rateChange WebSocket events (passed in as `wsMessage`).
 *
 * @param {object|null} wsMessage – latest message from useWebSocket's onMessage
 * @returns {number|null} rate – XLM price in USD, or null while loading
 */
export function useExchangeRate(wsMessage) {
  const [rate, setRate] = useState(null);

  useEffect(() => {
    axios.get('/api/stellar/exchange-rate/XLM/USD')
      .then(({ data }) => setRate(data.rate))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (wsMessage?.type === 'rateChange' && wsMessage.from === 'XLM' && wsMessage.to === 'USD') {
      setRate(wsMessage.rate);
    }
  }, [wsMessage]);

  return rate;
}
