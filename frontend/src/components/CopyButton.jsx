import { useEffect, useRef } from 'react';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';

/**
 * Inline copy button. Shows a "Copied!" toast for 2s on success,
 * or an error message on failure. Supports Ctrl+C when focused.
 */
export function CopyButton({ text, label = 'Copy' }) {
  const [copy, copied, copyError] = useCopyToClipboard();
  const btnRef = useRef(null);

  // Ctrl+C keyboard shortcut when button is focused
  useEffect(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        copy(text);
      }
    };
    btn.addEventListener('keydown', onKeyDown);
    return () => btn.removeEventListener('keydown', onKeyDown);
  }, [copy, text]);

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={btnRef}
        type="button"
        className="copy-btn"
        onClick={() => copy(text)}
        aria-label={`${label} — press Ctrl+C when focused`}
        title="Copy (Ctrl+C when focused)"
      >
        {copied ? '✓' : '⎘'}
      </button>
      {copied && <span className="copy-toast">Copied!</span>}
      {copyError && <span className="copy-toast copy-toast--error">{copyError}</span>}
    </span>
  );
}
