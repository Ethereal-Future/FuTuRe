// Dev-only state debugger — renders nothing in production
import { useAppState } from './AppStateContext.jsx';

export function StateDebugger() {
  if (import.meta.env.PROD) return null;

  const state = useAppState();
  // Mask secret key in debug view
  const display = {
    ...state,
    account: state.account
      ? { ...state.account, secretKey: state.account.secretKey ? '***' : undefined }
      : null,
  };

  return (
    <details
      style={{
        position: 'fixed', bottom: 8, right: 8, zIndex: 9999,
        background: '#1e1e2e', color: '#cdd6f4', fontSize: 11,
        padding: '6px 10px', borderRadius: 6, maxWidth: 340,
        maxHeight: 320, overflow: 'auto', opacity: 0.92,
      }}
    >
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>🛠 State</summary>
      <pre style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {JSON.stringify(display, null, 2)}
      </pre>
    </details>
  );
}
