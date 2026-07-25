import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAccount, getTransactions, getExchangeRate, getAccountLabel, updateAccountLabel, sendPayment, createAccount, importAccount, getNetworkStatus } from '../api/stellar.js';
import { getKycStatus } from '../api/compliance.js';

/**
 * Fetch account balance
 */
async function fetchBalance(publicKey) {
  if (!publicKey) return null;
  return getAccount(publicKey);
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
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

/**
 * Fetch transaction history with pagination
 */
async function fetchTransactions(publicKey, params) {
  if (!publicKey) return null;
  return getTransactions(publicKey, params);
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
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

/**
 * Fetch exchange rate
 */
async function fetchExchangeRate(from, to) {
  return getExchangeRate(from, to);
}

/**
 * Hook to fetch and cache exchange rate
 * Stale time: 60s, refetch on window focus, background refetch every 60s
 */
export function useExchangeRate(from = 'XLM', to = 'USD') {
  return useQuery({
    queryKey: ['exchangeRate', from, to],
    queryFn: () => fetchExchangeRate(from, to),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

/**
 * Fetch KYC status
 */
async function fetchKycStatus() {
  try {
    return await getKycStatus();
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
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
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
    return await getAccountLabel(publicKey);
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
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Mutation to save account label
 */
export function useSaveAccountLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ publicKey, accountLabel }) => {
      return updateAccountLabel(publicKey, accountLabel);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['accountLabel', variables.publicKey] });
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
      return sendPayment(payload);
    },
    onSuccess: () => {
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
      return createAccount();
    },
    onSuccess: () => {
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
      return importAccount(secretKey);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['accountLabel'] });
    },
  });
}

/**
 * Fetch network status
 */
async function fetchNetworkStatus() {
  return getNetworkStatus();
}

/**
 * Hook to fetch network status
 * Stale time: 30s, refetch every 30s
 */
export function useNetworkStatusQuery() {
  return useQuery({
    queryKey: ['networkStatus'],
    queryFn: fetchNetworkStatus,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}
