import { useState, useCallback } from 'react';

/**
 * Returns [copy, copied] where copy(text) copies to clipboard
 * and `copied` is true for 2 seconds after a successful copy.
 */
export function useCopyToClipboard() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  const copy = useCallback(async (text) => {
    setError(null);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers
        const el = document.createElement('textarea');
        el.value = text;
        el.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
        document.body.appendChild(el);
        el.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(el);
        if (!ok) throw new Error('execCommand copy failed');
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(err.message || 'Copy failed');
    }
  }, []);

  return [copy, copied, error];
}
