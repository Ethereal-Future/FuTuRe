import { useCallback, useState } from 'react';

// Display-currency preference is a client-only convenience, not sensitive
// data, so it is safe to keep in localStorage (readable by any script on
// the page) rather than persisting it server-side.
const STORAGE_KEY = 'preferredCurrency';
const DEFAULT_CURRENCY = 'XLM';
const SUPPORTED_CURRENCIES = ['XLM', 'USDC', 'USD', 'EUR'];

function readStoredCurrency() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return SUPPORTED_CURRENCIES.includes(stored) ? stored : DEFAULT_CURRENCY;
  } catch {
    return DEFAULT_CURRENCY;
  }
}

/**
 * Drop-in replacement for useState(defaultCurrency) that persists the
 * chosen display currency to localStorage so it survives reloads.
 */
export function useCurrencyPreference() {
  const [currency, setCurrencyState] = useState(readStoredCurrency);

  const setCurrency = useCallback((value) => {
    const next = typeof value === 'function' ? value(readStoredCurrency()) : value;
    const validated = SUPPORTED_CURRENCIES.includes(next) ? next : DEFAULT_CURRENCY;
    setCurrencyState(validated);
    try {
      window.localStorage.setItem(STORAGE_KEY, validated);
    } catch {
      // ignore localStorage failures (e.g. private browsing / quota)
    }
  }, []);

  return [currency, setCurrency];
}

export { SUPPORTED_CURRENCIES, DEFAULT_CURRENCY };
