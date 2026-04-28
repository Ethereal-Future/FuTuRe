import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * SecurityBestPracticesModal — comprehensive security guide modal.
 * Props: isOpen, onClose
 */
export function SecurityBestPracticesModal({ isOpen, onClose }) {
  const [currentTab, setCurrentTab] = useState('overview');

  const tabs = {
    overview: {
      title: 'Security Overview',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ padding: 12, background: '#f0fdf4', borderRadius: 6, borderLeft: '4px solid #22c55e' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#166534', marginBottom: 6 }}>
              🛡️ Security is Your Responsibility
            </div>
            <p style={{ margin: 0, fontSize: 13, color: '#166534' }}>
              This platform provides tools for Stellar transactions, but it is your responsibility to
              protect your secret keys and follow security best practices. We cannot recover lost keys
              or reverse fraudulent transactions.
            </p>
          </div>

          <div>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 13, fontWeight: 600 }}>Core Security Principles</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { icon: '🔐', title: 'Keep Keys Private', desc: 'Never share your secret key' },
                { icon: '🔒', title: 'Verify Recipients', desc: 'Always double-check addresses' },
                { icon: '💾', title: 'Secure Storage', desc: 'Store keys offline when possible' },
                { icon: '⚠️', title: 'Verify Networks', desc: 'Confirm testnet vs mainnet' }
              ].map((item, i) => (
                <div key={i} style={{
                  padding: 10,
                  background: '#f9fafb',
                  borderRadius: 6,
                  border: '1px solid #e5e7eb'
                }}>
                  <div style={{ fontSize: 18, marginBottom: 4 }}>{item.icon}</div>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{item.title}</div>
                  <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )
    },
    keys: {
      title: 'Secret Key Management',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              padding: 12,
              background: '#fef2f2',
              borderRadius: 6,
              borderLeft: '4px solid #ef4444'
            }}
          >
            <div style={{ fontWeight: 600, color: '#991b1b', marginBottom: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
              ⛔ <span>DO NOT</span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13, color: '#7f1d1d' }}>
              <li style={{ marginBottom: 6, display: 'flex', gap: 8 }}>
                <span>✗</span>
                <span>Share your secret key via email, chat, or messaging apps</span>
              </li>
              <li style={{ marginBottom: 6, display: 'flex', gap: 8 }}>
                <span>✗</span>
                <span>Paste your key into unknown websites or applications</span>
              </li>
              <li style={{ marginBottom: 6, display: 'flex', gap: 8 }}>
                <span>✗</span>
                <span>Store keys in plain text files on your computer</span>
              </li>
              <li style={{ marginBottom: 6, display: 'flex', gap: 8 }}>
                <span>✗</span>
                <span>Take screenshots of your key and share them</span>
              </li>
              <li style={{ display: 'flex', gap: 8 }}>
                <span>✗</span>
                <span>Ever give your key to anyone, even support staff</span>
              </li>
            </ul>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            style={{
              padding: 12,
              background: '#f0fdf4',
              borderRadius: 6,
              borderLeft: '4px solid #22c55e'
            }}
          >
            <div style={{ fontWeight: 600, color: '#166534', marginBottom: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
              ✓ <span>DO</span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13, color: '#166534' }}>
              <li style={{ marginBottom: 6, display: 'flex', gap: 8 }}>
                <span>✓</span>
                <span>Store your key in a password manager (1Password, Bitwarden, etc.)</span>
              </li>
              <li style={{ marginBottom: 6, display: 'flex', gap: 8 }}>
                <span>✓</span>
                <span>Use hardware wallets for significant amounts (Ledger, Trezor)</span>
              </li>
              <li style={{ marginBottom: 6, display: 'flex', gap: 8 }}>
                <span>✓</span>
                <span>Create an encrypted backup on secure cloud storage (iCloud/Google Drive)</span>
              </li>
              <li style={{ marginBottom: 6, display: 'flex', gap: 8 }}>
                <span>✓</span>
                <span>Keep backups on external drives in a safe location</span>
              </li>
              <li style={{ display: 'flex', gap: 8 }}>
                <span>✓</span>
                <span>Consider a multi-sig setup for large accounts</span>
              </li>
            </ul>
          </motion.div>
        </div>
      )
    },
    transactions: {
      title: 'Safe Transactions',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ padding: 12, background: '#f3f4f6', borderRadius: 6 }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 13, fontWeight: 600 }}>Before Every Transaction</h4>
            <ol style={{ listStyle: 'decimal', paddingLeft: 18, margin: 0, fontSize: 13, color: '#374151', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li><strong>Verify the recipient address</strong> — Take time to confirm it matches exactly</li>
              <li><strong>Double-check the amount</strong> — Confirm it's correct before sending</li>
              <li><strong>Review the network</strong> — Is this testnet or mainnet?</li>
              <li><strong>Check your balance</strong> — Ensure you have sufficient funds</li>
              <li><strong>Wait a few seconds</strong> — Give yourself time to reconsider</li>
              <li><strong>Never rush the process</strong> — Scammers use urgency as a tactic</li>
            </ol>
          </div>

          <div style={{ padding: 12, background: '#fef3c7', borderRadius: 6, borderLeft: '4px solid #f59e0b' }}>
            <div style={{ fontWeight: 600, marginBottom: 6, display: 'flex', gap: 6, alignItems: 'center', color: '#92400e' }}>
              ⚡ <span>Large Transaction Checklist</span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13, color: '#92400e' }}>
              <li style={{ marginBottom: 6, display: 'flex', gap: 8 }}>
                <input type="checkbox" disabled style={{ accentColor: '#f59e0b' }} />
                <span>Contact recipient to confirm they're expecting the transfer</span>
              </li>
              <li style={{ marginBottom: 6, display: 'flex', gap: 8 }}>
                <input type="checkbox" disabled style={{ accentColor: '#f59e0b' }} />
                <span>Use a test transaction with a smaller amount first</span>
              </li>
              <li style={{ marginBottom: 6, display: 'flex', gap: 8 }}>
                <input type="checkbox" disabled style={{ accentColor: '#f59e0b' }} />
                <span>Compare recipient address character by character</span>
              </li>
              <li style={{ display: 'flex', gap: 8 }}>
                <input type="checkbox" disabled style={{ accentColor: '#f59e0b' }} />
                <span>Send from a secure device if possible</span>
              </li>
            </ul>
          </div>
        </div>
      )
    },
    network: {
      title: 'Network Awareness',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ padding: 12, background: '#dbeafe', borderRadius: 6, borderLeft: '4px solid #0284c7' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 13, fontWeight: 600, color: '#0c4a6e' }}>Testnet</h4>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13, color: '#0c4a6e' }}>
              <li style={{ marginBottom: 4, display: 'flex', gap: 6 }}>
                <span>🧪</span>
                <span><strong>For testing and development only</strong></span>
              </li>
              <li style={{ marginBottom: 4, display: 'flex', gap: 6 }}>
                <span>💰</span>
                <span>Funds have <strong>no real value</strong></span>
              </li>
              <li style={{ marginBottom: 4, display: 'flex', gap: 6 }}>
                <span>🔄</span>
                <span>Testnet can be reset without notice</span>
              </li>
              <li style={{ display: 'flex', gap: 6 }}>
                <span>🆓</span>
                <span>Get free test funds from the friendbot</span>
              </li>
            </ul>
          </div>

          <div style={{ padding: 12, background: '#fef2f2', borderRadius: 6, borderLeft: '4px solid #ef4444' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 13, fontWeight: 600, color: '#991b1b' }}>Mainnet</h4>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13, color: '#991b1b' }}>
              <li style={{ marginBottom: 4, display: 'flex', gap: 6 }}>
                <span>💎</span>
                <span><strong>Real money and real value</strong></span>
              </li>
              <li style={{ marginBottom: 4, display: 'flex', gap: 6 }}>
                <span>⚠️</span>
                <span>Transactions are permanent and irrevocable</span>
              </li>
              <li style={{ marginBottom: 4, display: 'flex', gap: 6 }}>
                <span>🚫</span>
                <span>No undo button — exercise extreme caution</span>
              </li>
              <li style={{ display: 'flex', gap: 6 }}>
                <span>🎯</span>
                <span>Always verify network before sending real funds</span>
              </li>
            </ul>
          </div>
        </div>
      )
    },
    recovery: {
      title: 'If Something Goes Wrong',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ padding: 12, background: '#fef2f2', borderRadius: 6, borderLeft: '4px solid #ef4444' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 13, fontWeight: 600, color: '#991b1b' }}>Suspected Compromise</h4>
            <div style={{ fontSize: 13, color: '#7f1d1d' }}>
              <p style={{ marginBottom: 8 }}>If you believe your secret key has been compromised:</p>
              <ol style={{ paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <li><strong>Act immediately</strong> — Transfer all funds to a new account</li>
                <li><strong>Use a new device</strong> — If possible, use a clean computer</li>
                <li><strong>Create a new account</strong> — From the new clean device</li>
                <li><strong>Transfer all remaining funds</strong> — From the old account to the new one</li>
                <li><strong>Never reuse the old key</strong> — Consider it permanently compromised</li>
              </ol>
            </div>
          </div>

          <div style={{ padding: 12, background: '#fef3c7', borderRadius: 6, borderLeft: '4px solid #f59e0b' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 13, fontWeight: 600, color: '#92400e' }}>Lost Key Recovery</h4>
            <div style={{ fontSize: 13, color: '#78350f' }}>
              <p style={{ margin: 0 }}>
                <strong>Unfortunately, if you lose your secret key:</strong> Your account and all funds
                are lost permanently. There is no way to recover them. This is why secure backups are critical.
              </p>
            </div>
          </div>

          <div style={{ padding: 12, background: '#f0fdf4', borderRadius: 6, borderLeft: '4px solid #22c55e' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 13, fontWeight: 600, color: '#166534' }}>Need Help?</h4>
            <div style={{ fontSize: 13, color: '#166534' }}>
              Visit <a href="https://stellar.org/developers" target="_blank" rel="noopener noreferrer" style={{ color: '#059669' }}>
                Stellar Developers Documentation
              </a> for more resources and support.
            </div>
          </div>
        </div>
      )
    }
  };

  if (!isOpen) return null;

  return (
    <motion.div
      className="security-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <motion.div
        className="security-modal"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          maxWidth: 600,
          maxHeight: '85vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          padding: 16,
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <h2 style={{ margin: 0, fontSize: 18, display: 'flex', gap: 8, alignItems: 'center' }}>
            🛡️ Security Best Practices
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              color: '#999',
              padding: 0,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid #e5e7eb',
          background: '#f9fafb',
          overflowX: 'auto',
        }}>
          {Object.entries(tabs).map(([key, tab]) => (
            <button
              key={key}
              onClick={() => setCurrentTab(key)}
              style={{
                flex: 1,
                minWidth: 120,
                padding: '12px 16px',
                background: currentTab === key ? 'white' : 'transparent',
                border: 'none',
                borderBottom: currentTab === key ? '2px solid #0066cc' : 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: currentTab === key ? 600 : 500,
                color: currentTab === key ? '#0066cc' : '#666',
                transition: 'all 0.2s',
              }}
            >
              {tab.title}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: 16,
        }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={currentTab}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {tabs[currentTab].content}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div style={{
          padding: 16,
          borderTop: '1px solid #e5e7eb',
          background: '#f9fafb',
          display: 'flex',
          gap: 8,
        }}>
          <motion.button
            onClick={onClose}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            style={{
              flex: 1,
              padding: '10px 16px',
              background: '#0066cc',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            I Understand
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
