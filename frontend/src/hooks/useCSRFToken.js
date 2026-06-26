import { useState, useEffect } from 'react';

/**
 * useCSRFToken hook - fetches and manages CSRF token for state-mutating requests
 * Stores token in memory (not localStorage) to prevent XSS exfiltration
 * @returns {string | null} CSRF token
 */
export function useCSRFToken() {
  const [csrfToken, setCSRFToken] = useState(null);

  useEffect(() => {
    const fetchCSRFToken = async () => {
      try {
        const response = await fetch('/api/v1/auth/csrf-token', {
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch CSRF token: ${response.statusText}`);
        }

        const data = await response.json();
        setCSRFToken(data.csrfToken);
      } catch (err) {
        console.error('Error fetching CSRF token:', err);
      }
    };

    fetchCSRFToken();
  }, []);

  return csrfToken;
}

/**
 * Helper function to add CSRF token to fetch request headers
 * @param {Record<string, string>} headers - existing headers object
 * @param {string | null} csrfToken - CSRF token from useCSRFToken hook
 * @returns {Record<string, string>} headers with CSRF token added
 */
export function addCSRFTokenToHeaders(headers, csrfToken) {
  if (!csrfToken) return headers;

  return {
    ...headers,
    'X-CSRF-Token': csrfToken,
  };
}
