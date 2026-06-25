import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getExchangeRate } from '../api/stellar.js';

/**
 * Fetches the XLM → fiatCurrency exchange rate.
 * Keeps it fresh via rateChange WebSocket events.
 *
 * @param {object|null} wsMessage – latest message from useWebSocket
 * @param {string} [fiatCurrency='USD'] – preferred fiat currency (e.g. 'USD', 'EUR', 'PHP')
 * @returns {{ rate: number|null, loading: boolean, error: Error|null }}
 */
export function useExchangeRate(wsMessage, fiatCurrency = 'USD') {
  const currency = fiatCurrency?.toUpperCase() || 'USD';
  const queryClient = useQueryClient();

  const { data: rate, isLoading, error } = useQuery({
    queryKey: ['exchangeRate', 'XLM', currency],
    queryFn: () => getExchangeRate('XLM', currency),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    if (
      wsMessage?.type === 'rateChange' &&
      wsMessage.from === 'XLM' &&
      wsMessage.to === currency
    ) {
      queryClient.setQueryData(['exchangeRate', 'XLM', currency], wsMessage.rate);
    }
  }, [wsMessage, queryClient, currency]);

  return { rate: rate ?? null, loading: isLoading, error };
}
