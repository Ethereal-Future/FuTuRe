import { useEffect, useState } from 'react';

/**
 * Debounce hook that delays state updates
 * @param {any} value - the value to debounce
 * @param {number} delay - debounce delay in ms (default: 300)
 * @returns {any} debounced value
 */
export function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}
