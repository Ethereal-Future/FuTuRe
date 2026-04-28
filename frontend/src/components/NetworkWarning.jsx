import { motion } from 'framer-motion';

/**
 * NetworkWarning — displays network-specific warnings.
 * Props: networkStatus (from useNetworkStatus)
 */
export function NetworkWarning({ networkStatus }) {
  if (!networkStatus) return null;

  const isTestnet = networkStatus.network === 'testnet';
  const online = networkStatus.online;

  if (isTestnet) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          background: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)',
          border: '2px solid #0284c7',
          borderRadius: 8,
          padding: 14,
          marginBottom: 14,
          display: 'flex',
          gap: 12,
        }}
      >
        <span style={{ fontSize: 22, flexShrink: 0 }}>🧪</span>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 4px 0', color: '#0c4a6e', fontSize: 14, fontWeight: 600 }}>
            Testnet Mode
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: '#0c4a6e' }}>
            You are using Stellar <strong>Testnet</strong>. Funds have <strong>no real value</strong> here.
            This is suitable for testing and development only. For real transactions, switch to Mainnet.
          </p>
        </div>
      </motion.div>
    );
  }

  if (!online) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)',
          border: '2px solid #ef4444',
          borderRadius: 8,
          padding: 14,
          marginBottom: 14,
          display: 'flex',
          gap: 12,
        }}
      >
        <span style={{ fontSize: 22, flexShrink: 0 }}>🌐</span>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 4px 0', color: '#991b1b', fontSize: 14, fontWeight: 600 }}>
            Network Offline
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: '#7f1d1d' }}>
            Cannot connect to Stellar network. Check your internet connection and try again.
            Transactions are disabled until the network is available.
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
        border: '2px solid #22c55e',
        borderRadius: 8,
        padding: 14,
        marginBottom: 14,
        display: 'flex',
        gap: 12,
      }}
    >
      <span style={{ fontSize: 22, flexShrink: 0 }}>✅</span>
      <div style={{ flex: 1 }}>
        <h3 style={{ margin: '0 0 4px 0', color: '#166534', fontSize: 14, fontWeight: 600 }}>
          Mainnet Connected
        </h3>
        <p style={{ margin: 0, fontSize: 13, color: '#166534' }}>
          Connected to Stellar Mainnet. <strong>Real funds are at risk.</strong> Always verify
          recipient addresses and transaction amounts carefully before sending.
        </p>
      </div>
    </motion.div>
  );
}

/**
 * NetworkStatus — quick network status display for forms.
 * Props: networkStatus, compact (show minimal version)
 */
export function NetworkStatus({ networkStatus, compact = false }) {
  if (!networkStatus) return null;

  const isTestnet = networkStatus.network === 'testnet';
  const online = networkStatus.online;

  if (compact) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        background: isTestnet ? '#dbeafe' : (online ? '#f0fdf4' : '#fef2f2'),
        border: `1px solid ${isTestnet ? '#0284c7' : (online ? '#22c55e' : '#ef4444')}`,
        borderRadius: 4,
        fontSize: 12,
        color: isTestnet ? '#0c4a6e' : (online ? '#166534' : '#991b1b'),
        fontWeight: 500,
      }}>
        <span>{isTestnet ? '🧪' : (online ? '✅' : '❌')}</span>
        <span>{isTestnet ? 'Testnet' : (online ? 'Mainnet • Online' : 'Offline')}</span>
      </div>
    );
  }

  if (isTestnet) {
    return (
      <div style={{
        padding: 10,
        background: '#dbeafe',
        border: '1px solid #0284c7',
        borderRadius: 6,
        fontSize: 12,
        color: '#0c4a6e',
      }}>
        🧪 Testnet — Test funds only, no real value
      </div>
    );
  }

  if (!online) {
    return (
      <div style={{
        padding: 10,
        background: '#fef2f2',
        border: '1px solid #ef4444',
        borderRadius: 6,
        fontSize: 12,
        color: '#991b1b',
      }}>
        ❌ Network Offline — Cannot process transactions
      </div>
    );
  }

  return (
    <div style={{
      padding: 10,
      background: '#f0fdf4',
      border: '1px solid #22c55e',
      borderRadius: 6,
      fontSize: 12,
      color: '#166534',
    }}>
      ✅ Mainnet Connected — Real funds
    </div>
  );
}
