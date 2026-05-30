import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import axios from 'axios';

const TIMEOUT_MS = 30000;

function withTimeout(promiseFn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return promiseFn(controller.signal).finally(() => clearTimeout(timer));
}

async function fetchExchangeRate(from, to) {
  const { data } = await withTimeout(signal =>
    axios.get(`/api/stellar/exchange-rate/${from}/${to}`, { signal })
  );
  return data.rate;
}

/**
 * Fetches the XLM/USD exchange rate with automatic caching and refetching.
 * Keeps it fresh via rateChange WebSocket events (passed in as `wsMessage`).
 * 
 * React Query handles:
 * - Initial fetch on mount
 * - Background refetch every 60s
 * - Refetch on window focus
 * - Automatic retry on failure
 * - Caching for 60s
 *
 * @param {object|null} wsMessage – latest message from useWebSocket's onMessage
 * @returns {{ rate: number|null, isLoading: boolean, error: Error|null }}
 */
export function useExchangeRate(wsMessage) {
  const queryClient = useQueryClient();
  const { data: rate, isLoading, error } = useQuery({
    queryKey: ['exchangeRate', 'XLM', 'USD'],
    queryFn: () => fetchExchangeRate('XLM', 'USD'),
    staleTime: 60 * 1000, // 60 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 60 * 1000, // Refetch every 60 seconds
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  // Update cache when WebSocket sends rate change
  useEffect(() => {
    if (wsMessage?.type === 'rateChange' && wsMessage.from === 'XLM' && wsMessage.to === 'USD') {
      queryClient.setQueryData(['exchangeRate', 'XLM', 'USD'], wsMessage.rate);
    }
  }, [wsMessage, queryClient]);

  return { rate: rate ?? null, loading: isLoading, error };
}
