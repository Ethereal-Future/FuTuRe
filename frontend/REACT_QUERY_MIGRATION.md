# React Query Migration Summary

## Overview
Successfully migrated the frontend from manual `useEffect` + `useState` patterns to **@tanstack/react-query** for server state management. This eliminates stale data, enables automatic background refetching, provides built-in caching, and removes duplicated loading/error state logic.

## Changes Made

### 1. Installation
- Added `@tanstack/react-query` to dependencies
- Installed via: `npm install @tanstack/react-query`

### 2. New Files Created

#### `src/config/queryClient.js`
- Centralized QueryClient configuration
- Default retry strategy: 1 retry with exponential backoff
- Default stale time: 60 seconds
- Default cache time (gcTime): 5 minutes

#### `src/hooks/useQueryHooks.js`
- **`useBalance(publicKey)`** - Fetches account balance with 30s stale time, 60s refetch interval
- **`useTransactions(publicKey, params)`** - Fetches transaction history with 60s stale time
- **`useExchangeRate(from, to)`** - Fetches exchange rates with 60s stale time, 60s refetch interval
- **`useKycStatus()`** - Fetches KYC status with 5min stale time
- **`useAccountLabel(publicKey)`** - Fetches account label with 10min stale time
- **`useSaveAccountLabel()`** - Mutation to save account label
- **`useSendPayment()`** - Mutation to send payment with automatic balance/transaction invalidation
- **`useCreateAccount()`** - Mutation to create account with automatic query invalidation
- **`useImportAccount()`** - Mutation to import account with automatic query invalidation
- **`useNetworkStatusQuery()`** - Fetches network status with 30s stale time, 30s refetch interval

### 3. Modified Files

#### `src/main.jsx`
- Wrapped app with `QueryClientProvider` from `@tanstack/react-query`
- Imported `queryClient` from config
- Provider placed inside `AppStateProvider` for proper context hierarchy

#### `src/hooks/useExchangeRate.js`
- Replaced manual `useState` + `useEffect` with `useQuery`
- Automatic 60s background refetch
- WebSocket updates via `queryClient.setQueryData()` instead of `setState`
- Maintains same API: `{ rate, loading, error }`

#### `src/App.jsx`
- Removed manual `useNetworkStatus` hook (replaced with `useNetworkStatusQuery`)
- Removed manual `checkBalance` function (replaced with `useBalance` + `refetchBalance`)
- Removed manual `fetchKycStatus` function (replaced with `useKycStatus`)
- Removed manual `loadLabel` function (replaced with `useAccountLabel`)
- Removed manual `saveLabel` axios call (replaced with `useSaveAccountLabel` mutation)
- Replaced `createAccount` to use `useCreateAccount` mutation
- Replaced `importAccount` to use `useImportAccount` mutation
- Replaced `confirmPayment` to use `useSendPayment` mutation
- Synced React Query balance data to Redux store via `useEffect`
- Updated keyboard shortcuts to use `refetchBalance()` instead of `checkBalance()`
- Removed `kycLoading` and `kycError` local state (handled by React Query)
- Removed `useNetworkStatus` import and hook call

## Benefits

### ✅ Automatic Background Refetching
- Balance refetches every 60 seconds automatically
- Exchange rates refetch every 60 seconds automatically
- Network status refetches every 30 seconds automatically
- No manual polling logic needed

### ✅ Stale Data Prevention
- Data marked as stale after configured time
- Automatic refetch on window focus
- Automatic refetch on network reconnect
- Configurable per query

### ✅ Built-in Caching
- 5-minute default cache (gcTime)
- Prevents redundant API calls
- Automatic cache invalidation on mutations
- Manual cache updates via `setQueryData`

### ✅ Simplified Error Handling
- Automatic retry with exponential backoff
- Consistent error handling across all queries
- Error state available on every query

### ✅ Reduced Boilerplate
- No more manual loading/error state management
- No more manual useEffect cleanup
- No more manual retry logic
- Mutations handle optimistic updates automatically

### ✅ WebSocket Integration
- WebSocket updates can directly update cache via `setQueryData`
- No need for manual state synchronization
- Real-time data stays in sync with cache

## Migration Checklist

- [x] Install @tanstack/react-query
- [x] Create QueryClient configuration
- [x] Create custom query hooks
- [x] Wrap app with QueryClientProvider
- [x] Update useExchangeRate to use React Query
- [x] Update App.jsx to use query hooks
- [x] Remove manual useEffect patterns
- [x] Remove manual loading/error state
- [x] Test balance fetching
- [x] Test transaction history
- [x] Test exchange rate updates
- [x] Test KYC status fetching
- [x] Test account label saving
- [x] Test payment sending
- [x] Test account creation/import

## Stale Times Configuration

| Query | Stale Time | Refetch Interval | Cache Time |
|-------|-----------|-----------------|-----------|
| Balance | 30s | 60s | 5min |
| Transactions | 60s | - | 10min |
| Exchange Rate | 60s | 60s | 5min |
| KYC Status | 5min | - | 10min |
| Account Label | 10min | - | 30min |
| Network Status | 30s | 30s | 5min |

## Notes

- All mutations automatically invalidate related queries
- Balance and transaction queries invalidate on payment send
- Account queries invalidate on account creation/import
- WebSocket messages can update cache directly without refetch
- Redux store still used for UI state (form fields, modals, etc.)
- React Query handles all server state management
