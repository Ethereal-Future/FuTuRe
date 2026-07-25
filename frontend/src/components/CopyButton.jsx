import { useState } from 'react';

export function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API unavailable (e.g. insecure context) — nothing more we can do
    }
  };

  return (
    <span className="copy-btn-wrap">
      <button type="button" className="copy-btn" onClick={handleCopy} aria-label={label} title={label}>
        {copied ? '✓' : '⧉'}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </span>
  );
}
