import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

const TIMEOUT_MS = 30000;

function withTimeout(promiseFn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return promiseFn(controller.signal).finally(() => clearTimeout(timer));
}

/**
 * Fetch account balance
 */
async function fetchBalance(publicKey) {
  if (!publicKey) return null;
  const { data } = await withTimeout(signal =>
    axios.get(`/api/stellar/account/${publicKey}`, { signal })
  );
  return data;
}

/**
 * Hook to fetch and cache balance with automatic refetching
 * Stale time: 30s, refetch on window focus, background refetch every 60s
 */
export function useBalance(publicKey) {
  return useQuery({
    queryKey: ['balance', publicKey],
    queryFn: () => fetchBalance(publicKey),
    enabled: !!publicKey,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
    refetchInterval: 60 * 1000, // Refetch every 60 seconds
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

/**
 * Fetch transaction history with pagination
 */
async function fetchTransactions(publicKey, params) {
  if (!publicKey) return null;
  const { data } = await withTimeout(signal =>
    axios.get(`/api/stellar/account/${publicKey}/transactions`, { params, signal })
  );
  return data;
}

/**
 * Hook to fetch transaction history
 * Stale time: 60s, refetch on window focus
 */
export function useTransactions(publicKey, params = {}) {
  return useQuery({
    queryKey: ['transactions', publicKey, params],
    queryFn: () => fetchTransactions(publicKey, params),
    enabled: !!publicKey,
    staleTime: 60 * 1000, // 60 seconds
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

/**
 * Fetch exchange rate
 */
async function fetchExchangeRate(from, to) {
  const { data } = await withTimeout(signal =>
    axios.get(`/api/stellar/exchange-rate/${from}/${to}`, { signal })
  );
  return data.rate;
}

/**
 * Hook to fetch and cache exchange rate
 * Stale time: 60s, refetch on window focus, background refetch every 60s
 */
export function useExchangeRate(from = 'XLM', to = 'USD') {
  return useQuery({
    queryKey: ['exchangeRate', from, to],
    queryFn: () => fetchExchangeRate(from, to),
    staleTime: 60 * 1000, // 60 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 60 * 1000, // Refetch every 60 seconds
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

/**
 * Fetch KYC status
 */
async function fetchKycStatus() {
  try {
    const { data } = await withTimeout(signal =>
      axios.get('/api/compliance/kyc/status', { signal })
    );
    return data.status;
  } catch (error) {
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Hook to fetch and cache KYC status
 * Stale time: 5 minutes, refetch on window focus
 */
export function useKycStatus() {
  return useQuery({
    queryKey: ['kycStatus'],
    queryFn: fetchKycStatus,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

/**
 * Fetch account label
 */
async function fetchAccountLabel(publicKey) {
  if (!publicKey) return '';
  try {
    const { data } = await withTimeout(signal =>
      axios.get(`/api/stellar/account/${publicKey}/label`, { signal })
    );
    return data.accountLabel || '';
  } catch {
    return '';
  }
}

/**
 * Hook to fetch account label
 */
export function useAccountLabel(publicKey) {
  return useQuery({
    queryKey: ['accountLabel', publicKey],
    queryFn: () => fetchAccountLabel(publicKey),
    enabled: !!publicKey,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
}

/**
 * Mutation to save account label
 */
export function useSaveAccountLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ publicKey, accountLabel }) => {
      const { data } = await withTimeout(signal =>
        axios.put(`/api/stellar/account/${publicKey}/label`, { accountLabel }, { signal })
      );
      return data;
    },
    onSuccess: (data, variables) => {
      // Invalidate the label query for this account
      queryClient.invalidateQueries({
        queryKey: ['accountLabel', variables.publicKey],
      });
    },
  });
}

/**
 * Mutation to send payment
 */
export function useSendPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const { data } = await withTimeout(signal =>
        axios.post('/api/stellar/payment/send', payload, { signal })
      );
      return data;
    },
    onSuccess: () => {
      // Invalidate balance and transactions queries
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

/**
 * Mutation to create account
 */
export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await withTimeout(signal =>
        axios.post('/api/stellar/account/create', null, { signal })
      );
      return data;
    },
    onSuccess: () => {
      // Invalidate all account-related queries
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['accountLabel'] });
    },
  });
}

/**
 * Mutation to import account
 */
export function useImportAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (secretKey) => {
      const { data } = await withTimeout(signal =>
        axios.post('/api/stellar/account/import', { secretKey }, { signal })
      );
      return data;
    },
    onSuccess: () => {
      // Invalidate all account-related queries
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['accountLabel'] });
    },
  });
}

/**
 * Fetch network status
 */
async function fetchNetworkStatus() {
  const { data } = await withTimeout(signal =>
    axios.get('/api/stellar/network/status', { signal })
  );
  return data;
}

/**
 * Hook to fetch network status
 * Stale time: 30s, refetch every 30s
 */
export function useNetworkStatusQuery() {
  return useQuery({
    queryKey: ['networkStatus'],
    queryFn: fetchNetworkStatus,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 30 * 1000, // Refetch every 30 seconds
    refetchOnWindowFocus: true,
  });
}
